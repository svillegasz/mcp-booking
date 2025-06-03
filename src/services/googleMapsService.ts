import { Client } from "@googlemaps/google-maps-services-js";
import https from "https";
import axios from "axios";
import {
  Location,
  Restaurant,
  RestaurantSearchParams,
  GooglePlacesResponse,
  GooglePlaceDetailsResponse,
  GoogleGeocodingResponse
} from "../types/index.js";

export class GoogleMapsService {
  private client: Client;
  private apiKey: string;

  constructor(apiKey: string) {
    // Create an HTTPS agent that ignores SSL certificate errors (only for local development)
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false
    });

    // Create axios instance with custom HTTPS agent
    const axiosInstance = axios.create({
      httpsAgent: httpsAgent
    });

    this.client = new Client({
      axiosInstance: axiosInstance
    });
    this.apiKey = apiKey;
  }

  /**
   * Search for restaurants based on location, cuisine types, and other criteria
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
        radius = 7000,
        priceLevel
      } = params;

      // Determine the location to use for search
      let searchLocation: Location;

      if (placeName) {
        // Geocode the place name to get coordinates
        searchLocation = await this.geocodePlaceName(placeName);
      } else if (location) {
        // Use provided coordinates
        searchLocation = location;
      } else {
        throw new Error(
          "Either location coordinates or placeName must be provided"
        );
      }

      // Build search query based on cuisine types and keyword
      let searchQuery = "";

      // If keyword is provided, prioritize it
      if (keyword) {
        searchQuery = keyword;
        // If cuisine types are also provided, combine them
        if (cuisineTypes.length > 0) {
          searchQuery += ` ${cuisineTypes.join(" OR ")}`;
        }
      } else if (cuisineTypes.length > 0) {
        searchQuery = cuisineTypes.join(" OR ");
      } else {
        searchQuery = "restaurant";
      }

      //   console.log(`🔍 Search Query: "${searchQuery}"`);
      //   if (priceLevel) {
      //     console.log(`💰 Price Level Filter: ${priceLevel} (${this.getPriceLevelDescription(priceLevel)})`);
      //   }

      // Build API request parameters
      const apiParams: any = {
        location: `${searchLocation.latitude},${searchLocation.longitude}`,
        radius,
        type: "restaurant",
        keyword: searchQuery,
        key: this.apiKey
      };

      // Add price level filter if specified
      if (priceLevel) {
        apiParams.minprice = priceLevel;
        apiParams.maxprice = priceLevel;
      }

      const response = await this.client.placesNearby({
        params: apiParams
      });

      if (response.data.status !== "OK") {
        throw new Error(`Google Places API error: ${response.data.status}`);
      }

      // Get detailed information for each restaurant
      const restaurants: Restaurant[] = [];
      const results = response.data.results || [];

      // Limit to top 20 results to avoid API quota issues
      const limitedResults = results.slice(0, 20);

      for (const place of limitedResults) {
        try {
          if (place.place_id) {
            const restaurant = await this.getRestaurantDetails(place.place_id);
            if (restaurant) {
              restaurants.push(restaurant);
            }
          }
        } catch (error) {
          console.warn(
            `Failed to get details for place ${place.place_id}:`,
            error
          );
          // Continue with other restaurants
        }
      }

      return restaurants;
    } catch (error) {
      console.error("Error searching restaurants:", error);
      throw new Error(
        `Failed to search restaurants: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * 🆕 NEW: Geocode a place name to get latitude and longitude coordinates
   */
  async geocodePlaceName(placeName: string): Promise<Location> {
    try {
      const response = await this.client.geocode({
        params: {
          address: placeName,
          key: this.apiKey
        }
      });

      if (response.data.status !== "OK") {
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
        longitude: location.lng
      };
    } catch (error) {
      console.error(`Error geocoding place name "${placeName}":`, error);
      throw new Error(
        `Failed to geocode place name: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get detailed information about a specific restaurant
   */
  async getRestaurantDetails(placeId: string): Promise<Restaurant | null> {
    try {
      const response = await this.client.placeDetails({
        params: {
          place_id: placeId,
          fields: [
            // Basic fields
            "place_id",
            "name",
            "formatted_address",
            "geometry",
            "types",
            "photos",
            // Contact fields
            "formatted_phone_number",
            "website",
            "opening_hours",
            // Atmosphere fields (including reservation-related)
            "rating",
            "user_ratings_total",
            "price_level",
            "reviews",
            "reservable", // 🆕 NEW: Indicates if place supports reservations
            "curbside_pickup", // 🆕 NEW: Supports curbside pickup
            "delivery", // 🆕 NEW: Supports delivery
            "dine_in", // 🆕 NEW: Supports dine-in
            "takeout", // 🆕 NEW: Supports takeout
            "serves_breakfast", // 🆕 NEW: Serves breakfast
            "serves_lunch", // 🆕 NEW: Serves lunch
            "serves_dinner", // 🆕 NEW: Serves dinner
            "serves_brunch", // 🆕 NEW: Serves brunch
            "serves_beer", // 🆕 NEW: Serves beer
            "serves_wine", // 🆕 NEW: Serves wine
            "serves_vegetarian_food" // 🆕 NEW: Serves vegetarian food
          ],
          key: this.apiKey
        }
      });

      if (response.data.status !== "OK") {
        console.warn(
          `Failed to get place details for ${placeId}: ${response.data.status}`
        );
        return null;
      }

      const place = response.data.result as any;

      // 🔍 LOG RAW GOOGLE PLACES API RESPONSE
      //   console.log('\n🔍 RAW GOOGLE PLACES API RESPONSE:');
      //   console.log('='.repeat(80));
      //   console.log('📍 Place ID:', place.place_id);
      //   console.log('🏪 Name:', place.name);
      //   console.log('📍 Address:', place.formatted_address);
      //   console.log('📞 Phone:', place.formatted_phone_number || 'Not provided');
      //   console.log('🌐 Website:', place.website || 'Not provided');
      //   console.log('⭐ Rating:', place.rating || 'Not provided');
      //   console.log('👥 User Ratings Total:', place.user_ratings_total || 'Not provided');
      //   console.log('💰 Price Level:', place.price_level || 'Not provided');
      //   console.log('🏷️ Types:', place.types?.join(', ') || 'Not provided');

      //   if (place.opening_hours) {
      //     console.log('\n🕒 OPENING HOURS DATA:');
      //     console.log('   • Open Now:', place.opening_hours.open_now);
      //     if (place.opening_hours.weekday_text) {
      //       console.log('   • Weekday Text:');
      //       place.opening_hours.weekday_text.forEach((day: string) => {
      //         console.log('     -', day);
      //       });
      //     }
      //     if (place.opening_hours.periods) {
      //       console.log('   • Periods (Raw):');
      //       console.log(JSON.stringify(place.opening_hours.periods, null, 4));
      //     }
      //   }

      //   if (place.photos && place.photos.length > 0) {
      //     console.log('\n📸 PHOTOS DATA:');
      //     console.log('   • Photo Count:', place.photos.length);
      //     console.log('   • First Photo Reference:', place.photos[0].photo_reference);
      //   }

      //   if (place.reviews && place.reviews.length > 0) {
      //     console.log('\n📝 REVIEWS DATA:');
      //     console.log('   • Review Count:', place.reviews.length);
      //     console.log('   • First Review Author:', place.reviews[0].author_name);
      //     console.log('   • First Review Rating:', place.reviews[0].rating);
      //   }

      //   console.log('\n📊 COMPLETE RAW GOOGLE API RESPONSE:');
      //   console.log(JSON.stringify(place, null, 2));
      //   console.log('='.repeat(80));

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

      // 🎯 LOG BOOKING ANALYSIS RESULTS
      //   console.log('\n🎯 BOOKING ANALYSIS RESULTS:');
      //   console.log('='.repeat(50));
      //   console.log('Input Data:');
      //   console.log('   • Website URL:', place.website || 'None');
      //   console.log('   • Phone Number:', place.formatted_phone_number || 'None');
      //   console.log('\nBooking Analysis Results:');
      //   console.log(JSON.stringify(bookingInfo, null, 2));
      //   console.log('='.repeat(50));

      return {
        placeId: place.place_id,
        name: place.name,
        address: place.formatted_address,
        location: {
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng
        },
        rating: place.rating || 0,
        userRatingsTotal: place.user_ratings_total || 0,
        priceLevel: place.price_level,
        cuisineTypes: this.extractCuisineTypes(place.types || []),
        photos: place.photos?.map(
          (photo: any) =>
            `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${this.apiKey}`
        ),
        phoneNumber: place.formatted_phone_number,
        website: place.website,
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
              periods: place.opening_hours.periods?.map((period: any) => ({
                open: {
                  day: period.open?.day || 0,
                  time: period.open?.time || "0000"
                },
                close: period.close
                  ? {
                      day: period.close.day || 0,
                      time: period.close.time || "0000"
                    }
                  : undefined
              })),
              weekdayText: place.opening_hours.weekday_text
            }
          : undefined,
        reviews: place.reviews?.slice(0, 5).map((review: any) => ({
          authorName: review.author_name || "Anonymous",
          rating: review.rating || 0,
          text: review.text || "",
          time:
            typeof review.time === "number"
              ? review.time
              : parseInt(review.time) || 0
        }))
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
      | "opentable"
      | "resy"
      | "yelp"
      | "restaurant_website"
      | "google_reserve"
      | "other";
    supportsOnlineBooking: boolean;
    requiresPhone: boolean;
  } {
    const bookingInfo: {
      reservable: boolean;
      bookingUrl?: string;
      bookingPlatform?:
        | "opentable"
        | "resy"
        | "yelp"
        | "restaurant_website"
        | "google_reserve"
        | "other";
      supportsOnlineBooking: boolean;
      requiresPhone: boolean;
    } = {
      reservable: false,
      supportsOnlineBooking: false,
      requiresPhone: false
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
      if (url.includes("opentable.com") || url.includes("opentable")) {
        return {
          ...bookingInfo,
          reservable: true,
          bookingUrl: website,
          bookingPlatform: "opentable",
          supportsOnlineBooking: true,
          requiresPhone: false
        };
      }

      // Resy detection
      if (url.includes("resy.com") || url.includes("resy")) {
        return {
          ...bookingInfo,
          reservable: true,
          bookingUrl: website,
          bookingPlatform: "resy",
          supportsOnlineBooking: true,
          requiresPhone: false
        };
      }

      // Yelp reservations detection
      if (
        url.includes("yelp.com") &&
        (url.includes("reservations") || url.includes("book"))
      ) {
        return {
          ...bookingInfo,
          reservable: true,
          bookingUrl: website,
          bookingPlatform: "yelp",
          supportsOnlineBooking: true,
          requiresPhone: false
        };
      }

      // Google Reserve detection
      if (
        url.includes("reserve.google.com") ||
        url.includes("google.com/reserve")
      ) {
        return {
          ...bookingInfo,
          reservable: true,
          bookingUrl: website,
          bookingPlatform: "google_reserve",
          supportsOnlineBooking: true,
          requiresPhone: false
        };
      }

      // Generic restaurant website with potential booking
      if (this.hasBookingKeywords(url)) {
        return {
          ...bookingInfo,
          reservable: true,
          bookingUrl: website,
          bookingPlatform: "restaurant_website",
          supportsOnlineBooking: true,
          requiresPhone: false
        };
      }

      // Website exists but no clear booking platform detected
      bookingInfo.reservable = true;
      bookingInfo.bookingUrl = website;
      bookingInfo.bookingPlatform = "other";
    }

    return bookingInfo;
  }

  /**
   * Check if URL contains booking-related keywords
   */
  private hasBookingKeywords(url: string): boolean {
    const bookingKeywords = [
      "reservation",
      "reservations",
      "book",
      "booking",
      "table",
      "reserve",
      "dine",
      "dining",
      "order",
      "menu"
    ];

    return bookingKeywords.some((keyword) => url.includes(keyword));
  }

  /**
   * Extract cuisine types from Google Places types array
   */
  private extractCuisineTypes(types: string[]): string[] {
    const cuisineMap: { [key: string]: string } = {
      "chinese_restaurant": "Chinese",
      "japanese_restaurant": "Japanese",
      "korean_restaurant": "Korean",
      "thai_restaurant": "Thai",
      "vietnamese_restaurant": "Vietnamese",
      "indian_restaurant": "Indian",
      "italian_restaurant": "Italian",
      "french_restaurant": "French",
      "mexican_restaurant": "Mexican",
      "american_restaurant": "American",
      "mediterranean_restaurant": "Mediterranean",
      "greek_restaurant": "Greek",
      "turkish_restaurant": "Turkish",
      "spanish_restaurant": "Spanish",
      "german_restaurant": "German",
      "brazilian_restaurant": "Brazilian",
      "seafood_restaurant": "Seafood",
      "steakhouse": "Steakhouse",
      "pizza_restaurant": "Pizza",
      "bakery": "Bakery",
      "cafe": "Cafe",
      "fast_food_restaurant": "Fast Food",
      "fine_dining_restaurant": "Fine Dining",
      "buffet_restaurant": "Buffet",
      "barbecue_restaurant": "BBQ",
      "sushi_restaurant": "Sushi",
      "vegetarian_restaurant": "Vegetarian",
      "vegan_restaurant": "Vegan"
    };

    const cuisines: string[] = [];

    for (const type of types) {
      if (cuisineMap[type]) {
        cuisines.push(cuisineMap[type]);
      }
    }

    // If no specific cuisine found, add generic restaurant type
    if (cuisines.length === 0 && types.includes("restaurant")) {
      cuisines.push("Restaurant");
    }

    return cuisines;
  }

  /**
   * Get human-readable description for price level
   */
  private getPriceLevelDescription(priceLevel: number): string {
    const descriptions = {
      1: "Inexpensive",
      2: "Moderate",
      3: "Expensive",
      4: "Very Expensive"
    };
    return descriptions[priceLevel as keyof typeof descriptions] || "Unknown";
  }

  /**
   * Search for restaurants with specific cuisine types
   */
  async searchByCuisine(
    location: Location,
    cuisineType: string,
    radius: number = 20000
  ): Promise<Restaurant[]> {
    const searchParams: RestaurantSearchParams = {
      location,
      cuisineTypes: [cuisineType],
      mood: "",
      event: "casual dining",
      radius
    };

    return this.searchRestaurants(searchParams);
  }
}
