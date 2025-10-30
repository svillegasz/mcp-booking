#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import dotenv from 'dotenv';

import { GoogleMapsService } from './services/googleMapsService.js';
import { RestaurantRecommendationService } from './services/restaurantRecommendationService.js';
import { RestaurantSearchParams } from './types/index.js';

// Ensure no warnings or debug info goes to stdout (only to stderr)
// This is critical for stdio MCP transport - MUST be set up BEFORE dotenv.config()
if (process.env.NODE_ENV !== 'test') {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: any, encoding?: any, callback?: any): boolean => {
    // Only allow JSON-RPC messages to stdout
    const chunkStr = chunk.toString();
    if (chunkStr.includes('"jsonrpc"') || chunkStr.includes('"method"') || chunkStr.includes('"result"')) {
      return originalStdoutWrite(chunk, encoding, callback);
    }
    // Redirect everything else to stderr
    return process.stderr.write(chunk, encoding, callback);
  };
}

// Load environment variables (silent mode to avoid stdout pollution)
dotenv.config({ debug: false });

// Default coordinates for Taiwan
const DEFAULT_LATITUDE = parseFloat(
  process.env.DEFAULT_LATITUDE || '24.1501164'
);
const DEFAULT_LONGITUDE = parseFloat(
  process.env.DEFAULT_LONGITUDE || '120.6692299'
);
const DEFAULT_SEARCH_RADIUS = parseInt(
  process.env.DEFAULT_SEARCH_RADIUS || '3000'
); // 3km in meters

class RestaurantBookingServer {
  private googleMapsService: GoogleMapsService;
  private recommendationService: RestaurantRecommendationService;

  constructor() {
    // Initialize services
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
    }

    this.googleMapsService = new GoogleMapsService(apiKey);
    this.recommendationService = new RestaurantRecommendationService();
  }

  private createServer(): McpServer {
    const server = new McpServer({
      name: 'restaurant-booking-server',
      version: '1.0.0',
    });

    this.setupTools(server);
    return server;
  }

  private setupTools(server: McpServer) {
    // Search restaurants tool
    server.registerTool(
      'search_restaurants',
      {
        title: 'Search for restaurants',
        description:
          'Search for restaurants based on location, cuisine, keyword, mood, event, radius, price level, and locale',
        inputSchema: {
          latitude: z
            .number()
            .optional()
            .describe(
              `Latitude of the search location (default: ${DEFAULT_LATITUDE} - Medellin)`
            ),
          longitude: z
            .number()
            .optional()
            .describe(
              `Longitude of the search location (default: ${DEFAULT_LONGITUDE} - Medellin)`
            ),
          placeName: z
            .string()
            .optional()
            .describe(
              'Place name to search near (e.g., "New York", "Tokyo", "London"). Alternative to providing latitude/longitude coordinates.'
            ),
          cuisineTypes: z
            .array(z.string())
            .optional()
            .describe(
              'Array of preferred cuisine types (e.g., ["Italian", "Japanese", "Mexican"])'
            ),
          keyword: z
            .string()
            .optional()
            .describe(
              'Search for specific food types or dishes (e.g., "hotpot", "sushi", "pizza", "ramen", "dim sum", "barbecue")'
            ),
          mood: z
            .string()
            .optional()
            .describe(
              'Desired mood/atmosphere (e.g., "romantic", "casual", "upscale", "fun", "quiet")'
            ),
          event: z
            .string()
            .optional()
            .describe(
              "Type of event or occasion (e.g., 'dating', 'gathering', 'business', 'casual', 'celebration')"
            ),
          radius: z
            .number()
            .optional()
            .describe(
              `Search radius in meters (default: ${DEFAULT_SEARCH_RADIUS} = ${DEFAULT_SEARCH_RADIUS / 1000}km)`
            ),
          priceLevel: z
            .number()
            .min(1)
            .max(4)
            .optional()
            .describe(
              'Price level preference (1=inexpensive, 4=very expensive)'
            ),
          locale: z
            .string()
            .optional()
            .describe(
              'Locale for search results and Google API responses (e.g., "en" for English, "zh-TW" for Traditional Chinese, "ja" for Japanese, "ko" for Korean, "th" for Thai). Affects restaurant names, reviews, and other text content.'
            ),
          strictCuisineFiltering: z
            .boolean()
            .optional()
            .describe(
              'If true, only restaurants that match the specified cuisine types will be returned. If false (default), all restaurants will be returned but cuisine matches will be scored higher.'
            ),
          excludePlaceIds: z
            .array(z.string())
            .optional()
            .describe(
              'Array of Google Place IDs to exclude from results (e.g., restaurants already shown to the user). Use this to get additional recommendations.'
            ),
        },
      },
      async args => {
        return await this.handleSearchRestaurants(args);
      }
    );
  }

  private async handleSearchRestaurants(args: any) {
    const searchParams: RestaurantSearchParams = {
      // Only include location if placeName is not provided
      ...(args.placeName
        ? { placeName: args.placeName }
        : {
            location: {
              latitude: args.latitude || DEFAULT_LATITUDE,
              longitude: args.longitude || DEFAULT_LONGITUDE,
            },
          }),
      cuisineTypes: args.cuisineTypes || [],
      keyword: args.keyword,
      mood: args.mood,
      event: args.event,
      radius: args.radius || DEFAULT_SEARCH_RADIUS,
      priceLevel: args.priceLevel,
      locale: args.locale || 'en',
      strictCuisineFiltering: args.strictCuisineFiltering || false,
      excludePlaceIds: args.excludePlaceIds || [],
    };

    // Search for restaurants
    const restaurants =
      await this.googleMapsService.searchRestaurants(searchParams);

    if (restaurants.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No restaurants found matching your criteria. Try expanding your search radius or adjusting your preferences.',
          },
        ],
      };
    }

    // Get AI recommendations
    const recommendations = await this.recommendationService.getRecommendations(
      restaurants,
      searchParams
    );

    const result = {
      searchCriteria: searchParams,
      totalFound: restaurants.length,
      recommendations: recommendations.map(rec => ({
        restaurant: {
          placeId: rec.restaurant.placeId,
          name: rec.restaurant.name,
          address: rec.restaurant.address,
          rating: rec.restaurant.rating,
          userRatingsTotal: rec.restaurant.userRatingsTotal,
          priceLevel: rec.restaurant.priceLevel,
          cuisineTypes: rec.restaurant.cuisineTypes,
          phoneNumber: rec.restaurant.phoneNumber,
          website: rec.restaurant.website,
          googleMapsUrl: rec.restaurant.googleMapsUrl,
          openingHours: rec.restaurant.openingHours,
          distance: rec.restaurant.distance,
          bookingInfo: rec.restaurant.bookingInfo,
          reservable: rec.restaurant.reservable,
          curbsidePickup: rec.restaurant.curbsidePickup,
          delivery: rec.restaurant.delivery,
          dineIn: rec.restaurant.dineIn,
          takeout: rec.restaurant.takeout,
          servesBreakfast: rec.restaurant.servesBreakfast,
          servesLunch: rec.restaurant.servesLunch,
          servesDinner: rec.restaurant.servesDinner,
          servesBrunch: rec.restaurant.servesBrunch,
          servesBeer: rec.restaurant.servesBeer,
          servesWine: rec.restaurant.servesWine,
          servesVegetarianFood: rec.restaurant.servesVegetarianFood,
        },
        score: Math.round(rec.score * 10) / 10,
        reasoning: rec.reasoning,
        suitabilityForEvent: rec.suitabilityForEvent,
        moodMatch: rec.moodMatch,
      })),
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  async run() {
    // Create the server
    const server = this.createServer();

    // Create stdio transport
    const transport = new StdioServerTransport();

    // Connect server to transport
    await server.connect(transport);

    console.error('Restaurant Booking MCP Server running on stdio');
  }
}

// Start the server
const server = new RestaurantBookingServer();
server.run().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Handle server shutdown
process.on('SIGINT', async () => {
  console.error('Shutting down server...');
  process.exit(0);
});
