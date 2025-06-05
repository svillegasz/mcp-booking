#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";

import { GoogleMapsService } from "./services/googleMapsService.js";
import { RestaurantRecommendationService } from "./services/restaurantRecommendationService.js";
import { BookingService } from "./services/bookingService.js";
import {
  RestaurantSearchParams,
  Location,
  BookingRequest,
  Restaurant
} from "./types/index.js";

// Load environment variables
dotenv.config();

// Default coordinates for Taiwan
const DEFAULT_LATITUDE = 24.1501164;
const DEFAULT_LONGITUDE = 120.6692299;

class RestaurantBookingServer {
  private server: Server;
  private googleMapsService: GoogleMapsService;
  private recommendationService: RestaurantRecommendationService;
  private bookingService: BookingService;

  constructor() {
    this.server = new Server(
      {
        name: "restaurant-booking-server",
        version: "1.0.0"
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    // Initialize services
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_MAPS_API_KEY environment variable is required");
    }

    this.googleMapsService = new GoogleMapsService(apiKey);
    this.recommendationService = new RestaurantRecommendationService();
    this.bookingService = new BookingService();

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "search_restaurants",
            description:
              "Search for restaurants based on location, cuisine types, mood, and event type. Returns top 3 AI-recommended restaurants within 20km radius. You can also search for specific food types using keywords.",
            inputSchema: {
              type: "object",
              properties: {
                latitude: {
                  type: "number",
                  description:
                    "Latitude of the search location (default: 24.1501164 - Taiwan)",
                  default: 24.1501164
                },
                longitude: {
                  type: "number",
                  description:
                    "Longitude of the search location (default: 120.6692299 - Taiwan)",
                  default: 120.6692299
                },
                placeName: {
                  type: "string",
                  description:
                    'Place name to search near (e.g., "New York", "Tokyo", "London"). Alternative to providing latitude/longitude coordinates.'
                },
                cuisineTypes: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    'Array of preferred cuisine types (e.g., ["Italian", "Japanese", "Mexican"])'
                },
                keyword: {
                  type: "string",
                  description:
                    'Search for specific food types or dishes (e.g., "hotpot", "sushi", "pizza", "ramen", "dim sum", "barbecue")'
                },
                mood: {
                  type: "string",
                  description:
                    'Desired mood/atmosphere (e.g., "romantic", "casual", "upscale", "fun", "quiet")'
                },
                event: {
                  type: "string",
                  enum: [
                    "dating",
                    "family gathering",
                    "business meeting",
                    "casual dining",
                    "celebration"
                  ],
                  description: "Type of event or occasion"
                },
                radius: {
                  type: "number",
                  description:
                    "Search radius in meters (default: 20000 = 20km)",
                  default: 20000
                },
                priceLevel: {
                  type: "number",
                  enum: [1, 2, 3, 4],
                  description:
                    "Price level preference (1=inexpensive, 4=very expensive)"
                }
              },
              required: ["mood", "event"]
            }
          },
          {
            name: "get_restaurant_details",
            description:
              "Get detailed information about a specific restaurant including reviews, photos, and opening hours",
            inputSchema: {
              type: "object",
              properties: {
                placeId: {
                  type: "string",
                  description: "Google Places ID of the restaurant"
                }
              },
              required: ["placeId"]
            }
          },
          {
            name: "get_booking_instructions",
            description:
              "Get instructions on how to make a reservation at a specific restaurant",
            inputSchema: {
              type: "object",
              properties: {
                placeId: {
                  type: "string",
                  description: "Google Places ID of the restaurant"
                }
              },
              required: ["placeId"]
            }
          },
          {
            name: "check_availability",
            description:
              "Check availability for a restaurant reservation (mock implementation)",
            inputSchema: {
              type: "object",
              properties: {
                placeId: {
                  type: "string",
                  description: "Google Places ID of the restaurant"
                },
                dateTime: {
                  type: "string",
                  description:
                    'Preferred date and time in ISO format (e.g., "2024-01-15T19:00:00")'
                },
                partySize: {
                  type: "number",
                  description: "Number of people in the party"
                }
              },
              required: ["placeId", "dateTime", "partySize"]
            }
          },
          {
            name: "make_reservation",
            description:
              "Attempt to make a restaurant reservation (mock implementation)",
            inputSchema: {
              type: "object",
              properties: {
                placeId: {
                  type: "string",
                  description: "Google Places ID of the restaurant"
                },
                partySize: {
                  type: "number",
                  description: "Number of people in the party"
                },
                preferredDateTime: {
                  type: "string",
                  description: "Preferred date and time in ISO format"
                },
                contactName: {
                  type: "string",
                  description: "Name for the reservation"
                },
                contactPhone: {
                  type: "string",
                  description: "Phone number for the reservation"
                },
                contactEmail: {
                  type: "string",
                  description: "Email address (optional)"
                },
                specialRequests: {
                  type: "string",
                  description: "Any special requests or dietary restrictions"
                }
              },
              required: [
                "placeId",
                "partySize",
                "preferredDateTime",
                "contactName",
                "contactPhone"
              ]
            }
          }
        ] as Tool[]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "search_restaurants":
            return await this.handleSearchRestaurants(args);

          case "get_restaurant_details":
            return await this.handleGetRestaurantDetails(args);

          case "get_booking_instructions":
            return await this.handleGetBookingInstructions(args);

          case "check_availability":
            return await this.handleCheckAvailability(args);

          case "make_reservation":
            return await this.handleMakeReservation(args);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${
                error instanceof Error
                  ? error.message
                  : "Unknown error occurred"
              }`
            }
          ]
        };
      }
    });
  }

  private async handleSearchRestaurants(args: any) {
    const searchParams: RestaurantSearchParams = {
      // Only include location if placeName is not provided
      ...(args.placeName
        ? { placeName: args.placeName }
        : {
            location: {
              latitude: args.latitude || DEFAULT_LATITUDE,
              longitude: args.longitude || DEFAULT_LONGITUDE
            }
          }),
      cuisineTypes: args.cuisineTypes || [],
      keyword: args.keyword,
      mood: args.mood,
      event: args.event,
      radius: args.radius || 20000,
      priceLevel: args.priceLevel
    };

    // Search for restaurants
    const restaurants = await this.googleMapsService.searchRestaurants(
      searchParams
    );

    if (restaurants.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No restaurants found matching your criteria. Try expanding your search radius or adjusting your preferences."
          }
        ]
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
      recommendations: recommendations.map((rec) => ({
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
          openingHours: rec.restaurant.openingHours,
          photos: rec.restaurant.photos?.slice(0, 3) // Limit photos
        },
        score: Math.round(rec.score * 10) / 10,
        reasoning: rec.reasoning,
        suitabilityForEvent: rec.suitabilityForEvent,
        moodMatch: rec.moodMatch
      }))
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  private async handleGetRestaurantDetails(args: any) {
    const restaurant = await this.googleMapsService.getRestaurantDetails(
      args.placeId
    );

    if (!restaurant) {
      return {
        content: [
          {
            type: "text",
            text: "Restaurant not found or unable to retrieve details."
          }
        ]
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(restaurant, null, 2)
        }
      ]
    };
  }

  private async handleGetBookingInstructions(args: any) {
    const restaurant = await this.googleMapsService.getRestaurantDetails(
      args.placeId
    );

    if (!restaurant) {
      return {
        content: [
          {
            type: "text",
            text: "Restaurant not found."
          }
        ]
      };
    }

    const instructions = await this.bookingService.getBookingInstructions(
      restaurant
    );

    return {
      content: [
        {
          type: "text",
          text: instructions
        }
      ]
    };
  }

  private async handleCheckAvailability(args: any) {
    const restaurant = await this.googleMapsService.getRestaurantDetails(
      args.placeId
    );

    if (!restaurant) {
      return {
        content: [
          {
            type: "text",
            text: "Restaurant not found."
          }
        ]
      };
    }

    const availability = await this.bookingService.checkAvailability(
      restaurant,
      args.dateTime,
      args.partySize
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(availability, null, 2)
        }
      ]
    };
  }

  private async handleMakeReservation(args: any) {
    const restaurant = await this.googleMapsService.getRestaurantDetails(
      args.placeId
    );

    if (!restaurant) {
      return {
        content: [
          {
            type: "text",
            text: "Restaurant not found."
          }
        ]
      };
    }

    const bookingRequest: BookingRequest = {
      restaurant,
      partySize: args.partySize,
      preferredDateTime: args.preferredDateTime,
      specialRequests: args.specialRequests,
      contactInfo: {
        name: args.contactName,
        phone: args.contactPhone,
        email: args.contactEmail
      }
    };

    const result = await this.bookingService.makeReservation(bookingRequest);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Restaurant Booking MCP Server running on stdio");
  }
}

// Start the server
const server = new RestaurantBookingServer();
server.run().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
