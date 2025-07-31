import { GoogleMapsService } from '../services/googleMapsService.js';
import { RestaurantRecommendationService } from '../services/restaurantRecommendationService.js';
import { BookingService } from '../services/bookingService.js';
import { RestaurantSearchParams } from '../types/index.js';
import { getMemoryUsage } from './setup.js';

jest.mock('@googlemaps/google-maps-services-js');

describe('Integration Tests - Restaurant Search Flow', () => {
  let googleMapsService: GoogleMapsService;
  let recommendationService: RestaurantRecommendationService;
  let bookingService: BookingService;

  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    googleMapsService = new GoogleMapsService(mockApiKey);
    recommendationService = new RestaurantRecommendationService();
    bookingService = new BookingService();
    jest.clearAllMocks();
  });

  describe('Complete Search and Recommendation Flow', () => {
    test('should complete full flow within performance targets', async () => {
      // Mock Google Maps API responses
      const mockPlacesResponse = {
        data: {
          status: 'OK',
          results: Array.from({ length: 12 }, (_, i) => ({
            place_id: `place_${i}`,
            name: `Restaurant ${i}`,
            geometry: {
              location: {
                lat: 37.7749 + (Math.random() - 0.5) * 0.01,
                lng: -122.4194 + (Math.random() - 0.5) * 0.01,
              },
            },
            rating: 3.5 + Math.random() * 1.5,
            user_ratings_total: Math.floor(Math.random() * 500) + 50,
            types: ['restaurant', 'food', 'establishment'],
          })),
        },
      };

      const mockDetailsResponse = (placeId: string, index: number) => ({
        data: {
          status: 'OK',
          result: {
            place_id: placeId,
            name: `Restaurant ${index}`,
            formatted_address: `${index * 100} Restaurant Street, San Francisco, CA`,
            geometry: {
              location: {
                lat: 37.7749 + (Math.random() - 0.5) * 0.005,
                lng: -122.4194 + (Math.random() - 0.5) * 0.005,
              },
            },
            rating: 3.5 + Math.random() * 1.5,
            user_ratings_total: Math.floor(Math.random() * 500) + 50,
            price_level: Math.floor(Math.random() * 4) + 1,
            types: [
              'restaurant',
              index % 2 === 0 ? 'italian_restaurant' : 'japanese_restaurant',
            ],
            formatted_phone_number: `+1 555-${String(index).padStart(3, '0')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
            website: `https://restaurant${index}.com`,
            opening_hours: { open_now: Math.random() > 0.2 }, // 80% chance of being open
            reservable: Math.random() > 0.3, // 70% chance of being reservable
          },
        },
      });

      const mockClient = {
        placesNearby: jest.fn().mockResolvedValue(mockPlacesResponse),
        placeDetails: jest.fn().mockImplementation(({ params }) => {
          const index = parseInt(params.place_id.split('_')[1]);
          return Promise.resolve(mockDetailsResponse(params.place_id, index));
        }),
      };

      (googleMapsService as any).client = mockClient;

      const searchParams: RestaurantSearchParams = {
        location: { latitude: 37.7749, longitude: -122.4194 },
        cuisineTypes: ['Italian', 'Japanese'],
        mood: 'romantic',
        event: 'dating',
        radius: 2000,
        locale: 'en',
      };

      // PERFORMANCE TEST: Complete flow should finish within 2 seconds
      const startTime = Date.now();

      // Step 1: Search for restaurants
      const restaurants =
        await googleMapsService.searchRestaurants(searchParams);
      const searchDuration = Date.now() - startTime;

      // Step 2: Get recommendations
      const recommendationStartTime = Date.now();
      const recommendations = await recommendationService.getRecommendations(
        restaurants,
        searchParams
      );
      const recommendationDuration = Date.now() - recommendationStartTime;

      const totalDuration = Date.now() - startTime;

      // ASSERTIONS
      expect(totalDuration).toBeLessThan(2000); // Complete flow within 2 seconds
      expect(searchDuration).toBeLessThan(1500); // Search within 1.5 seconds
      expect(recommendationDuration).toBeLessThan(100); // Recommendations within 100ms

      expect(restaurants.length).toBeGreaterThan(0);
      expect(restaurants.length).toBeLessThanOrEqual(15); // Respects limit
      expect(recommendations).toHaveLength(3); // Returns top 3

      // Verify distance calculations
      restaurants.forEach(restaurant => {
        expect(restaurant.distance).toBeDefined();
        expect(restaurant.distance).toBeLessThanOrEqual(2000); // Within radius
      });

      // Verify sorting by distance
      for (let i = 1; i < restaurants.length; i++) {
        expect(restaurants[i].distance || 0).toBeGreaterThanOrEqual(
          restaurants[i - 1].distance || 0
        );
      }

      // Verify recommendation scoring
      for (let i = 1; i < recommendations.length; i++) {
        expect(recommendations[i].score).toBeLessThanOrEqual(
          recommendations[i - 1].score
        );
      }

      console.log(`Integration Test Performance:
        - Total Duration: ${totalDuration}ms
        - Search Duration: ${searchDuration}ms  
        - Recommendation Duration: ${recommendationDuration}ms
        - Restaurants Found: ${restaurants.length}
        - API Calls Made: ${mockClient.placeDetails.mock.calls.length}`);
    }, 10000);

    test('should handle concurrent search requests efficiently', async () => {
      const mockPlacesResponse = {
        data: {
          status: 'OK',
          results: [
            {
              place_id: 'concurrent_place',
              name: 'Concurrent Restaurant',
              geometry: { location: { lat: 37.7749, lng: -122.4194 } },
              rating: 4.5,
              types: ['restaurant'],
            },
          ],
        },
      };

      const mockDetailsResponse = {
        data: {
          status: 'OK',
          result: {
            place_id: 'concurrent_place',
            name: 'Concurrent Restaurant',
            formatted_address: '123 Concurrent St',
            geometry: { location: { lat: 37.7749, lng: -122.4194 } },
            rating: 4.5,
            user_ratings_total: 200,
            price_level: 2,
            types: ['restaurant', 'italian_restaurant'],
            formatted_phone_number: '+1 555-123-4567',
            website: 'https://concurrent.com',
            opening_hours: { open_now: true },
          },
        },
      };

      const mockClient = {
        placesNearby: jest.fn().mockResolvedValue(mockPlacesResponse),
        placeDetails: jest.fn().mockResolvedValue(mockDetailsResponse),
      };

      (googleMapsService as any).client = mockClient;

      const searchParams: RestaurantSearchParams = {
        location: { latitude: 37.7749, longitude: -122.4194 },
        cuisineTypes: ['Italian'],
        mood: 'casual',
        event: 'gathering',
        radius: 1000,
      };

      // Make 3 concurrent search requests
      const concurrentPromises = Array(3)
        .fill(null)
        .map(() => googleMapsService.searchRestaurants(searchParams));

      const startTime = Date.now();
      const results = await Promise.all(concurrentPromises);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000); // Should handle concurrent requests efficiently
      expect(results).toHaveLength(3);

      // Due to caching/deduplication, should make minimal API calls
      expect(mockClient.placesNearby.mock.calls.length).toBeLessThanOrEqual(3);
      expect(mockClient.placeDetails.mock.calls.length).toBeLessThanOrEqual(3);

      results.forEach(result => {
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Concurrent Restaurant');
      });
    });

    test('should handle booking flow integration', async () => {
      // Create a mock restaurant with booking info
      const mockRestaurant = {
        placeId: 'bookable-place',
        name: 'Bookable Restaurant',
        address: '123 Booking Street, San Francisco, CA',
        location: { latitude: 37.7749, longitude: -122.4194 },
        rating: 4.7,
        userRatingsTotal: 300,
        priceLevel: 3 as const,
        cuisineTypes: ['Italian', 'Fine Dining'],
        phoneNumber: '+1 555-BOOK-NOW',
        website: 'https://opentable.com/bookable-restaurant',
        bookingInfo: {
          reservable: true,
          supportsOnlineBooking: true,
          bookingUrl: 'https://opentable.com/bookable-restaurant',
          bookingPlatform: 'opentable' as const,
          requiresPhone: false,
        },
        distance: 500,
      };

      const bookingRequest = {
        restaurant: mockRestaurant,
        partySize: 4,
        preferredDateTime: new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString(),
        specialRequests: 'Window table if possible',
        contactInfo: {
          name: 'John Doe',
          phone: '+1 555-987-6543',
          email: 'john@example.com',
        },
      };

      const startTime = Date.now();
      const bookingResult =
        await bookingService.makeReservation(bookingRequest);
      const bookingInstructions =
        await bookingService.getBookingInstructions(mockRestaurant);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(200); // Booking operations should be fast
      expect(bookingResult.success).toBe(true);
      expect(bookingResult.message).toContain('OpenTable');
      expect(bookingResult.confirmationDetails).toContain(
        'Bookable Restaurant'
      );

      expect(bookingInstructions).toContain('OpenTable');
      expect(bookingInstructions).toContain('opentable.com');
    });
  });

  describe('Error Handling Integration', () => {
    test('should gracefully handle API failures', async () => {
      const mockClient = {
        placesNearby: jest
          .fn()
          .mockRejectedValue(new Error('API temporarily unavailable')),
        placeDetails: jest
          .fn()
          .mockRejectedValue(new Error('API temporarily unavailable')),
      };

      (googleMapsService as any).client = mockClient;

      const searchParams: RestaurantSearchParams = {
        location: { latitude: 37.7749, longitude: -122.4194 },
        cuisineTypes: ['Italian'],
        mood: 'casual',
        event: 'gathering',
      };

      const startTime = Date.now();

      // Should fail gracefully without hanging
      await expect(
        googleMapsService.searchRestaurants(searchParams)
      ).rejects.toThrow('Failed to search restaurants');

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should fail fast
    });

    test('should handle partial API failures', async () => {
      const mockPlacesResponse = {
        data: {
          status: 'OK',
          results: [
            {
              place_id: 'working_place',
              name: 'Working Restaurant',
              geometry: { location: { lat: 37.7749, lng: -122.4194 } },
              types: ['restaurant'],
            },
            {
              place_id: 'failing_place',
              name: 'Failing Restaurant',
              geometry: { location: { lat: 37.7759, lng: -122.4194 } },
              types: ['restaurant'],
            },
          ],
        },
      };

      const mockClient = {
        placesNearby: jest.fn().mockResolvedValue(mockPlacesResponse),
        placeDetails: jest.fn().mockImplementation(({ params }) => {
          if (params.place_id === 'failing_place') {
            return Promise.reject(new Error('Place details unavailable'));
          }
          return Promise.resolve({
            data: {
              status: 'OK',
              result: {
                place_id: params.place_id,
                name: 'Working Restaurant',
                formatted_address: '123 Working St',
                geometry: { location: { lat: 37.7749, lng: -122.4194 } },
                rating: 4.5,
                user_ratings_total: 100,
                types: ['restaurant'],
              },
            },
          });
        }),
      };

      (googleMapsService as any).client = mockClient;

      const searchParams: RestaurantSearchParams = {
        location: { latitude: 37.7749, longitude: -122.4194 },
        cuisineTypes: [],
        mood: '',
        event: '',
      };

      const restaurants =
        await googleMapsService.searchRestaurants(searchParams);

      // Should return only the working restaurant
      expect(restaurants).toHaveLength(1);
      expect(restaurants[0].name).toBe('Working Restaurant');
    });
  });

  describe('Caching Integration', () => {
    test('should utilize caching across service calls', async () => {
      const mockPlacesResponse = {
        data: {
          status: 'OK',
          results: [
            {
              place_id: 'cached_place',
              name: 'Cached Restaurant',
              geometry: { location: { lat: 37.7749, lng: -122.4194 } },
              types: ['restaurant'],
            },
          ],
        },
      };

      const mockDetailsResponse = {
        data: {
          status: 'OK',
          result: {
            place_id: 'cached_place',
            name: 'Cached Restaurant',
            formatted_address: '123 Cache St',
            geometry: { location: { lat: 37.7749, lng: -122.4194 } },
            rating: 4.5,
            user_ratings_total: 150,
            types: ['restaurant'],
          },
        },
      };

      const mockClient = {
        placesNearby: jest.fn().mockResolvedValue(mockPlacesResponse),
        placeDetails: jest.fn().mockResolvedValue(mockDetailsResponse),
      };

      (googleMapsService as any).client = mockClient;

      const searchParams: RestaurantSearchParams = {
        location: { latitude: 37.7749, longitude: -122.4194 },
        cuisineTypes: [],
        mood: '',
        event: '',
      };

      // First search
      const firstResults =
        await googleMapsService.searchRestaurants(searchParams);
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(1);

      // Second search - should use cached data
      const startTime = Date.now();
      const secondResults =
        await googleMapsService.searchRestaurants(searchParams);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(50); // Should be very fast due to caching
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(1); // No additional API calls
      expect(secondResults).toEqual(firstResults);
    });
  });

  describe('Memory and Resource Management', () => {
    test('should not leak memory with repeated operations', async () => {
      const initialMemory = getMemoryUsage();

      const mockPlacesResponse = {
        data: {
          status: 'OK',
          results: Array.from({ length: 5 }, (_, i) => ({
            place_id: `memory_place_${i}`,
            name: `Memory Restaurant ${i}`,
            geometry: { location: { lat: 37.7749, lng: -122.4194 } },
            types: ['restaurant'],
          })),
        },
      };

      const mockClient = {
        placesNearby: jest.fn().mockResolvedValue(mockPlacesResponse),
        placeDetails: jest.fn().mockImplementation(({ params }) =>
          Promise.resolve({
            data: {
              status: 'OK',
              result: {
                place_id: params.place_id,
                name: `Memory Restaurant ${params.place_id.split('_')[2]}`,
                formatted_address: '123 Memory St',
                geometry: { location: { lat: 37.7749, lng: -122.4194 } },
                rating: 4.0,
                user_ratings_total: 100,
                types: ['restaurant'],
              },
            },
          })
        ),
      };

      (googleMapsService as any).client = mockClient;

      // Perform multiple search operations
      for (let i = 0; i < 10; i++) {
        const searchParams: RestaurantSearchParams = {
          location: {
            latitude: 37.7749 + i * 0.001,
            longitude: -122.4194 + i * 0.001,
          },
          cuisineTypes: ['Italian'],
          mood: 'casual',
          event: 'gathering',
        };

        const restaurants =
          await googleMapsService.searchRestaurants(searchParams);
        await recommendationService.getRecommendations(
          restaurants,
          searchParams
        );
      }

      // Force garbage collection
      if (global.gc) global.gc();

      const finalMemory = getMemoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be reasonable (less than 20MB)
      expect(memoryIncrease).toBeLessThan(20);

      console.log(`Memory Usage Test:
        - Initial: ${initialMemory.heapUsed}MB
        - Final: ${finalMemory.heapUsed}MB  
        - Increase: ${memoryIncrease}MB`);
    });
  });
});
