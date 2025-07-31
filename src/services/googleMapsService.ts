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
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes cache

  // Request deduplication
  private pendingRequests: Map<string, Promise<any>> = new Map();

  // Performance monitoring
  private requestTimes: number[] = [];
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private circuitBreakerThreshold: number = 5; // Max failures before circuit breaker

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
   * Cache management methods
   */
  private getCachedData(key: string): any | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.cacheTimeout) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  private setCachedData(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Performance monitoring methods
   */
  private recordRequestTime(duration: number): void {
    this.requestTimes.push(duration);
    // Keep only last 100 requests for moving average
    if (this.requestTimes.length > 100) {
      this.requestTimes.shift();
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
  }

  private shouldSkipRequest(): boolean {
    // Circuit breaker: skip requests if too many recent failures
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return (
      this.failureCount >= this.circuitBreakerThreshold &&
      this.lastFailureTime > fiveMinutesAgo
    );
  }

  private getAverageRequestTime(): number {
    if (this.requestTimes.length === 0) return 0;
    return (
      this.requestTimes.reduce((a, b) => a + b, 0) / this.requestTimes.length
    );
  }

  /**
   * Get performance metrics for monitoring
   */
  getPerformanceMetrics(): {
    averageRequestTime: number;
    failureCount: number;
    totalRequests: number;
    cacheSize: number;
    circuitBreakerActive: boolean;
  } {
    return {
      averageRequestTime: this.getAverageRequestTime(),
      failureCount: this.failureCount,
      totalRequests: this.requestTimes.length,
      cacheSize: this.cache.size,
      circuitBreakerActive: this.shouldSkipRequest(),
    };
  }

  /**
   * Reset performance counters (useful for testing)
   */
  resetPerformanceMetrics(): void {
    this.requestTimes = [];
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Execute promises with limited concurrency to avoid overwhelming the API
   * Optimized version with proper semaphore-like concurrency control
   */
  private async executeConcurrently<T>(
    promises: (() => Promise<T>)[],
    concurrency: number = 10 // Increased from 5 to 10
  ): Promise<T[]> {
    const results: T[] = [];
    let index = 0;

    // Worker function that processes promises
    const worker = async (): Promise<void> => {
      while (index < promises.length) {
        const currentIndex = index++;
        if (currentIndex >= promises.length) break;

        try {
          const result = await promises[currentIndex]();
          results[currentIndex] = result; // Maintain order
        } catch (error) {
          results[currentIndex] = null as T; // Handle errors gracefully
        }
      }
    };

    // Create worker pool
    const workers = Array(Math.min(concurrency, promises.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);
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
        this.recordFailure();
        throw new Error(`Google Places API error: ${response.data.status}`);
      }

      // Get detailed information for each restaurant
      const results = response.data.results || [];

      // Pre-filter by distance using Google's location data before API calls
      // Filter first to avoid unnecessary object creation for out-of-range places
      const placesWithDistance: Array<{ place: any; distance: number }> = [];
      
      for (const place of results) {
        if (!place.geometry?.location) continue;

        const distance = this.calculateDistance(
          searchLocation.latitude,
          searchLocation.longitude,
          place.geometry.location.lat,
          place.geometry.location.lng
        );

        if (distance <= radius) {
          placesWithDistance.push({ place, distance });
        }
      }

      // Sort by distance and limit results
      const preFilteredResults = placesWithDistance
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 15) // Reduced from 20 to 15 for better performance
        .map(({ place, distance }) => ({ ...place, preliminaryDistance: distance }));

      // 🚀 PERFORMANCE OPTIMIZATION: Use controlled concurrency for API calls
      const restaurantPromises = preFilteredResults.map(place => async () => {
        try {
          if (place.place_id) {
            // Check cache first
            const cacheKey = `restaurant:${place.place_id}:${locale}`;
            let restaurant = this.getCachedData(cacheKey);

            if (!restaurant) {
              // Check for pending request to avoid duplicate calls
              const requestKey = `pending:${cacheKey}`;
              let requestPromise = this.pendingRequests.get(requestKey);

              if (!requestPromise) {
                requestPromise = this.getRestaurantDetails(
                  place.place_id,
                  locale,
                  false // Only basic fields for search results
                );
                this.pendingRequests.set(requestKey, requestPromise);

                // Clean up pending request when done
                requestPromise.finally(() => {
                  this.pendingRequests.delete(requestKey);
                });
              }

              restaurant = await requestPromise;

              if (restaurant) {
                this.setCachedData(cacheKey, restaurant);
              }
            }

            if (restaurant) {
              // Use pre-calculated distance
              restaurant.distance = Math.round(place.preliminaryDistance);
              return restaurant;
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

      // Wait for all API calls to complete with controlled concurrency
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

      // Log performance metrics periodically
      if (this.requestTimes.length % 10 === 0 && this.requestTimes.length > 0) {
        const metrics = this.getPerformanceMetrics();
        console.log(
          `📊 GoogleMapsService Performance: ${JSON.stringify(metrics)}`
        );
      }

      return restaurants;
    } catch (error) {
      // console.error('Error searching restaurants:', error);
      this.recordFailure();
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
    // Check circuit breaker
    if (this.shouldSkipRequest()) {
      throw new Error(
        'Circuit breaker activated - geocoding temporarily unavailable'
      );
    }

    const startTime = Date.now();

    try {
      const response = await this.client.geocode({
        params: {
          address: placeName,
          language: locale,
          key: this.apiKey,
        },
      });

      // Record successful request time
      const duration = Date.now() - startTime;
      this.recordRequestTime(duration);

      if (response.data.status !== 'OK') {
        this.recordFailure();
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
      this.recordFailure();
      throw new Error(
        `Failed to geocode place name: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Get detailed information about a specific restaurant
   * Optimized with minimal required fields for initial search
   */
  async getRestaurantDetails(
    placeId: string,
    locale: string = 'en',
    includeExtendedFields: boolean = false
  ): Promise<Restaurant | null> {
    // Check cache first
    const cacheKey = `restaurant:${placeId}:${locale}:${includeExtendedFields}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) {
      return cached;
    }

    // Check circuit breaker
    if (this.shouldSkipRequest()) {
      console.warn('Circuit breaker activated - skipping API request');
      return null;
    }

    // Check for pending request to avoid duplicate calls
    const requestKey = `pending:${cacheKey}`;
    let requestPromise = this.pendingRequests.get(requestKey);

    if (requestPromise) {
      return requestPromise;
    }

    const startTime = Date.now();

    // Create the actual request promise
    requestPromise = this.executeRestaurantDetailsRequest(
      placeId,
      locale,
      includeExtendedFields,
      startTime
    );
    this.pendingRequests.set(requestKey, requestPromise);

    // Clean up pending request when done
    requestPromise.finally(() => {
      this.pendingRequests.delete(requestKey);
    });

    const result = await requestPromise;

    // Cache the result
    if (result) {
      this.setCachedData(cacheKey, result);
    }

    return result;
  }

  private async executeRestaurantDetailsRequest(
    placeId: string,
    locale: string,
    includeExtendedFields: boolean,
    startTime: number
  ): Promise<Restaurant | null> {
    try {
      // Essential fields for search results
      const basicFields = [
        'place_id',
        'name',
        'formatted_address',
        'geometry',
        'types',
        'rating',
        'user_ratings_total',
        'price_level',
        'formatted_phone_number',
        'website',
        'opening_hours/open_now', // Only current status, not full hours
        'reservable',
      ];

      // Extended fields for detailed view (loaded on-demand)
      const extendedFields = [
        'opening_hours',
        'reviews',
        'curbside_pickup',
        'delivery',
        'dine_in',
        'takeout',
        'serves_breakfast',
        'serves_lunch',
        'serves_dinner',
        'serves_brunch',
        'serves_beer',
        'serves_wine',
        'serves_vegetarian_food',
      ];

      const fields = includeExtendedFields
        ? [...basicFields, ...extendedFields]
        : basicFields;

      const response = await this.client.placeDetails({
        params: {
          place_id: placeId,
          language: locale as any,
          fields,
          key: this.apiKey,
        },
      });

      // Record successful request time
      const duration = Date.now() - startTime;
      this.recordRequestTime(duration);

      if (response.data.status !== 'OK') {
        console.warn(
          `Failed to get place details for ${placeId}: ${response.data.status}`
        );
        this.recordFailure();
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
      this.recordFailure();
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
      let hostname = '';
      try {
        hostname = new URL(website).hostname.toLowerCase();
      } catch (e) {
        // If website is not a valid URL, fallback to substring checks (optional)
        hostname = '';
      }

      // OpenTable detection
      if (hostname === 'opentable.com' || hostname.endsWith('.opentable.com')) {
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
      if (hostname === 'resy.com' || hostname.endsWith('.resy.com')) {
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
        (hostname === 'yelp.com' || hostname.endsWith('.yelp.com')) &&
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
        hostname === 'reserve.google.com' ||
        (hostname === 'google.com' && url.includes('/reserve'))
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
