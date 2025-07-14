import { Client } from '@googlemaps/google-maps-services-js';
import https from 'https';
import axios from 'axios';
import {
  Location,
  Restaurant,
  RestaurantSearchParams,
} from '../types/index.js';

export class GoogleMapsService {
  private client: Client;
  private apiKey: string;

  constructor(apiKey: string) {
    // Create an HTTPS agent that ignores SSL certificate errors (only for local development)
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    // Create axios instance with custom HTTPS agent and timeout
    const axiosInstance = axios.create({
      httpsAgent: httpsAgent,
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'mcp-booking-service/1.0',
      },
    });

    this.client = new Client({
      axiosInstance: axiosInstance,
    });
    this.apiKey = apiKey;
  }

  /**
   * Calculate the distance between two points using the Haversine formula
   * @param lat1 Latitude of first point
   * @param lon1 Longitude of first point
   * @param lat2 Latitude of second point
   * @param lon2 Longitude of second point
   * @returns Distance in meters
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in meters
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Execute promises with limited concurrency to avoid overwhelming the API
   */
  private async executeConcurrently<T>(
    promises: (() => Promise<T>)[],
    concurrency: number = 5
  ): Promise<T[]> {
    const results: T[] = [];
    const executing: Promise<void>[] = [];

    for (const promiseFactory of promises) {
      const promise = promiseFactory().then(result => {
        results.push(result);
      });

      executing.push(promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
        executing.splice(
          executing.findIndex(p => p === promise),
          1
        );
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Search for restaurants based on location, cuisine types, and other criteria
   *
   * This method ensures strict radius filtering by:
   * 1. Using Google Places API with the specified radius as a hint
   * 2. Calculating the actual distance using Haversine formula for each result
   * 3. Filtering out restaurants that exceed the specified radius
   * 4. Sorting results by distance (closest first)
   * 5. Adding distance information to each restaurant object
   */
  async searchRestaurants(
    params: RestaurantSearchParams
  ): Promise<Restaurant[]> {
    try {
      const {
        location,
        placeName,
        cuisineTypes,
        keyword,
        radius = 2000,
        priceLevel,
        locale = 'en',
      } = params;

      // Determine the location to use for search
      let searchLocation: Location;

      if (placeName) {
        // Geocode the place name to get coordinates
        searchLocation = await this.geocodePlaceName(placeName, locale);
      } else if (location) {
        // Use provided coordinates
        searchLocation = location;
      } else {
        throw new Error(
          'Either location coordinates or placeName must be provided'
        );
      }

      // Build search query based on cuisine types and keyword
      let searchQuery = '';

      // If keyword is provided, prioritize it
      if (keyword) {
        searchQuery = keyword;
        // If cuisine types are also provided, combine them
        if (cuisineTypes && cuisineTypes.length > 0) {
          searchQuery += ` ${cuisineTypes.join(' OR ')}`;
        }
      } else if (cuisineTypes && cuisineTypes.length > 0) {
        searchQuery = cuisineTypes.join(' OR ');
      } else {
        searchQuery = 'restaurant';
      }

      // Build API request parameters
      const apiParams: any = {
        location: `${searchLocation.latitude},${searchLocation.longitude}`,
        radius,
        type: 'restaurant',
        keyword: searchQuery,
        language: locale,
        key: this.apiKey,
      };

      // Add price level filter if specified
      if (priceLevel) {
        apiParams.minprice = priceLevel;
        apiParams.maxprice = priceLevel;
      }

      const response = await this.client.placesNearby({
        params: apiParams,
      });

      if (response.data.status !== 'OK') {
        throw new Error(`Google Places API error: ${response.data.status}`);
      }

      // Get detailed information for each restaurant
      const results = response.data.results || [];

      // Limit to top 20 results to avoid API quota issues
      const limitedResults = results.slice(0, 20);

      // 🚀 PERFORMANCE OPTIMIZATION: Use controlled concurrency for API calls
      const restaurantPromises = limitedResults.map(place => async () => {
        try {
          if (place.place_id) {
            const restaurant = await this.getRestaurantDetails(
              place.place_id,
              locale
            );

            if (restaurant) {
              // Calculate distance from search location to restaurant
              const distance = this.calculateDistance(
                searchLocation.latitude,
                searchLocation.longitude,
                restaurant.location.latitude,
                restaurant.location.longitude
              );

              // Only include restaurants within the specified radius
              if (distance <= radius) {
                // Add distance information to the restaurant object
                restaurant.distance = Math.round(distance);
                return restaurant;
              }
            }
          }
        } catch (error) {
          console.error(
            `Error getting details for place ${place.place_id}:`,
            error
          );
        }
        return null;
      });

      // Wait for all API calls to complete with controlled concurrency (max 5 simultaneous)
      const restaurantResults = await this.executeConcurrently(
        restaurantPromises,
        5
      );

      // Filter out null results
      const restaurants = restaurantResults.filter(
        (restaurant): restaurant is Restaurant => restaurant !== null
      );

      // Sort restaurants by distance (closest first)
      restaurants.sort((a, b) => {
        const distanceA = a.distance || 0;
        const distanceB = b.distance || 0;
        return distanceA - distanceB;
      });

      return restaurants;
    } catch (error) {
      // console.error('Error searching restaurants:', error);
      throw new Error(
        `Failed to search restaurants: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * 🆕 NEW: Geocode a place name to get latitude and longitude coordinates
   */
  async geocodePlaceName(
    placeName: string,
    locale: string = 'en'
  ): Promise<Location> {
    try {
      const response = await this.client.geocode({
        params: {
          address: placeName,
          language: locale,
          key: this.apiKey,
        },
      });

      if (response.data.status !== 'OK') {
        throw new Error(`Geocoding API error: ${response.data.status}`);
      }

      const results = response.data.results;
      if (!results || results.length === 0) {
        throw new Error(`No location found for place name: ${placeName}`);
      }

      // Use the first (most relevant) result
      const location = results[0].geometry.location;

      return {
        latitude: location.lat,
        longitude: location.lng,
      };
    } catch (error) {
      console.error(`Error geocoding place name "${placeName}":`, error);
      throw new Error(
        `Failed to geocode place name: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Get detailed information about a specific restaurant
   */
  async getRestaurantDetails(
    placeId: string,
    locale: string = 'en'
  ): Promise<Restaurant | null> {
    try {
      const response = await this.client.placeDetails({
        params: {
          place_id: placeId,
          language: locale as any,
          fields: [
            // Basic fields
            'place_id',
            'name',
            'formatted_address',
            'geometry',
            'types',
            // "photos",
            // Contact fields
            'formatted_phone_number',
            'website',
            'opening_hours',
            // Atmosphere fields (including reservation-related)
            'rating',
            'user_ratings_total',
            'price_level',
            'reviews',
            'reservable', // 🆕 NEW: Indicates if place supports reservations
            'curbside_pickup', // 🆕 NEW: Supports curbside pickup
            'delivery', // 🆕 NEW: Supports delivery
            'dine_in', // 🆕 NEW: Supports dine-in
            'takeout', // 🆕 NEW: Supports takeout
            'serves_breakfast', // 🆕 NEW: Serves breakfast
            'serves_lunch', // 🆕 NEW: Serves lunch
            'serves_dinner', // 🆕 NEW: Serves dinner
            'serves_brunch', // 🆕 NEW: Serves brunch
            'serves_beer', // 🆕 NEW: Serves beer
            'serves_wine', // 🆕 NEW: Serves wine
            'serves_vegetarian_food', // 🆕 NEW: Serves vegetarian food
          ],
          key: this.apiKey,
        },
      });

      if (response.data.status !== 'OK') {
        console.warn(
          `Failed to get place details for ${placeId}: ${response.data.status}`
        );
        return null;
      }

      const place = response.data.result as any;

      // Validate required fields
      if (
        !place.place_id ||
        !place.name ||
        !place.formatted_address ||
        !place.geometry?.location
      ) {
        // console.warn(`Missing required fields for place ${placeId}`);
        return null;
      }

      // Analyze booking information from website
      const bookingInfo = this.analyzeBookingInfo(
        place.website,
        place.formatted_phone_number
      );

      // Generate Google Maps URL
      const googleMapsUrl = this.generateGoogleMapsUrl(place.place_id);

      return {
        placeId: place.place_id,
        name: place.name,
        address: place.formatted_address,
        location: {
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng,
        },
        rating: place.rating || 0,
        userRatingsTotal: place.user_ratings_total || 0,
        priceLevel: place.price_level,
        cuisineTypes: this.extractCuisineTypes(place.types || []),
        // photos: place.photos?.map(
        //   (photo: any) =>
        //     `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${this.apiKey}`
        // ),
        phoneNumber: place.formatted_phone_number,
        website: place.website,
        googleMapsUrl,
        bookingInfo,
        // 🆕 NEW: Google Places API reservation and service fields
        reservable: place.reservable || false,
        curbsidePickup: place.curbside_pickup || false,
        delivery: place.delivery || false,
        dineIn: place.dine_in || false,
        takeout: place.takeout || false,
        servesBreakfast: place.serves_breakfast || false,
        servesLunch: place.serves_lunch || false,
        servesDinner: place.serves_dinner || false,
        servesBrunch: place.serves_brunch || false,
        servesBeer: place.serves_beer || false,
        servesWine: place.serves_wine || false,
        servesVegetarianFood: place.serves_vegetarian_food || false,
        openingHours: place.opening_hours
          ? {
              openNow: place.opening_hours.open_now || false,
              weekdayText: place.opening_hours.weekday_text,
            }
          : undefined,
      };
    } catch (error) {
      //   console.error(`Error getting restaurant details for ${placeId}:`, error);
      return null;
    }
  }

  /**
   * Analyze booking information from website URL and phone number
   */
  private analyzeBookingInfo(
    website?: string,
    phoneNumber?: string
  ): {
    reservable: boolean;
    bookingUrl?: string;
    bookingPlatform?:
      | 'opentable'
      | 'resy'
      | 'yelp'
      | 'restaurant_website'
      | 'google_reserve'
      | 'other';
    supportsOnlineBooking: boolean;
    requiresPhone: boolean;
  } {
    const bookingInfo: {
      reservable: boolean;
      bookingUrl?: string;
      bookingPlatform?:
        | 'opentable'
        | 'resy'
        | 'yelp'
        | 'restaurant_website'
        | 'google_reserve'
        | 'other';
      supportsOnlineBooking: boolean;
      requiresPhone: boolean;
    } = {
      reservable: false,
      supportsOnlineBooking: false,
      requiresPhone: false,
    };

    // Check if phone number is available for reservations
    if (phoneNumber) {
      bookingInfo.reservable = true;
      bookingInfo.requiresPhone = true;
    }

    // Analyze website for booking platforms
    if (website) {
      const url = website.toLowerCase();

      // OpenTable detection
      if (url.includes('opentable.com') || url.includes('opentable')) {
        return {
          ...bookingInfo,
          reservable: true,
          bookingUrl: website,
          bookingPlatform: 'opentable',
          supportsOnlineBooking: true,
          requiresPhone: false,
        };
      }

      // Resy detection
      if (url.includes('resy.com') || url.includes('resy')) {
        return {
          ...bookingInfo,
          reservable: true,
          bookingUrl: website,
          bookingPlatform: 'resy',
          supportsOnlineBooking: true,
          requiresPhone: false,
        };
      }

      // Yelp reservations detection
      if (
        url.includes('yelp.com') &&
        (url.includes('reservations') || url.includes('book'))
      ) {
        return {
          ...bookingInfo,
          reservable: true,
          bookingUrl: website,
          bookingPlatform: 'yelp',
          supportsOnlineBooking: true,
          requiresPhone: false,
        };
      }

      // Google Reserve detection
      if (
        url.includes('reserve.google.com') ||
        url.includes('google.com/reserve')
      ) {
        return {
          ...bookingInfo,
          reservable: true,
          bookingUrl: website,
          bookingPlatform: 'google_reserve',
          supportsOnlineBooking: true,
          requiresPhone: false,
        };
      }

      // Generic restaurant website with potential booking
      if (this.hasBookingKeywords(url)) {
        return {
          ...bookingInfo,
          reservable: true,
          bookingUrl: website,
          bookingPlatform: 'restaurant_website',
          supportsOnlineBooking: true,
          requiresPhone: false,
        };
      }

      // Website exists but no clear booking platform detected
      bookingInfo.reservable = true;
      bookingInfo.bookingUrl = website;
      bookingInfo.bookingPlatform = 'other';
    }

    return bookingInfo;
  }

  /**
   * Check if URL contains booking-related keywords
   */
  private hasBookingKeywords(url: string): boolean {
    const bookingKeywords = [
      'reservation',
      'reservations',
      'book',
      'booking',
      'table',
      'reserve',
      'dine',
      'dining',
      'order',
      'menu',
    ];

    return bookingKeywords.some(keyword => url.includes(keyword));
  }

  /**
   * Generate Google Maps URL for a restaurant
   */
  private generateGoogleMapsUrl(placeId: string): string {
    // Use place_id for the most accurate Google Maps URL
    // This format directly opens the place in Google Maps
    return `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${placeId}`;
  }

  /**
   * Extract cuisine types from Google Places types array
   */
  private extractCuisineTypes(types: string[]): string[] {
    const cuisineMap: { [key: string]: string } = {
      chinese_restaurant: 'Chinese',
      japanese_restaurant: 'Japanese',
      korean_restaurant: 'Korean',
      thai_restaurant: 'Thai',
      vietnamese_restaurant: 'Vietnamese',
      indian_restaurant: 'Indian',
      italian_restaurant: 'Italian',
      french_restaurant: 'French',
      mexican_restaurant: 'Mexican',
      american_restaurant: 'American',
      mediterranean_restaurant: 'Mediterranean',
      greek_restaurant: 'Greek',
      turkish_restaurant: 'Turkish',
      spanish_restaurant: 'Spanish',
      german_restaurant: 'German',
      brazilian_restaurant: 'Brazilian',
      seafood_restaurant: 'Seafood',
      steakhouse: 'Steakhouse',
      pizza_restaurant: 'Pizza',
      bakery: 'Bakery',
      cafe: 'Cafe',
      fast_food_restaurant: 'Fast Food',
      fine_dining_restaurant: 'Fine Dining',
      buffet_restaurant: 'Buffet',
      barbecue_restaurant: 'BBQ',
      sushi_restaurant: 'Sushi',
      vegetarian_restaurant: 'Vegetarian',
      vegan_restaurant: 'Vegan',
    };

    const cuisines: string[] = [];

    for (const type of types) {
      if (cuisineMap[type]) {
        cuisines.push(cuisineMap[type]);
      }
    }

    // If no specific cuisine found, add generic restaurant type
    if (cuisines.length === 0 && types.includes('restaurant')) {
      cuisines.push('Restaurant');
    }

    return cuisines;
  }

  /**
   * Get human-readable description for price level
   */
  private getPriceLevelDescription(priceLevel: number): string {
    const descriptions = {
      1: 'Inexpensive',
      2: 'Moderate',
      3: 'Expensive',
      4: 'Very Expensive',
    };
    return descriptions[priceLevel as keyof typeof descriptions] || 'Unknown';
  }

  /**
   * Search for restaurants with specific cuisine types
   */
  async searchByCuisine(
    location: Location,
    cuisineType: string,
    radius: number = 7000,
    locale: string = 'en'
  ): Promise<Restaurant[]> {
    const searchParams: RestaurantSearchParams = {
      location,
      cuisineTypes: [cuisineType],
      mood: '',
      event: 'casual dining',
      radius,
      locale,
    };

    return this.searchRestaurants(searchParams);
  }
}
