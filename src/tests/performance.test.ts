import { GoogleMapsService } from '../services/googleMapsService.js';
import { RestaurantRecommendationService } from '../services/restaurantRecommendationService.js';
import { BookingService } from '../services/bookingService.js';
import { RestaurantSearchParams, Restaurant } from '../types/index.js';

// Mock API responses to avoid real API calls during testing
jest.mock('@googlemaps/google-maps-services-js');

describe('Performance Tests', () => {
  let googleMapsService: GoogleMapsService;
  let recommendationService: RestaurantRecommendationService;
  let bookingService: BookingService;

  const mockApiKey = 'test-api-key';
  const mockSearchParams: RestaurantSearchParams = {
    location: { latitude: 37.7749, longitude: -122.4194 },
    cuisineTypes: ['Italian', 'Japanese'],
    mood: 'romantic',
    event: 'dating',
    radius: 2000,
    locale: 'en',
  };

  beforeEach(() => {
    googleMapsService = new GoogleMapsService(mockApiKey);
    recommendationService = new RestaurantRecommendationService();
    bookingService = new BookingService();
    jest.clearAllMocks();
  });

  describe('GoogleMapsService Performance', () => {
    test('should complete restaurant search within 2 seconds', async () => {
      // Mock the Google Maps API responses
      const mockPlacesResponse = {
        data: {
          status: 'OK',
          results: Array.from({ length: 15 }, (_, i) => ({
            place_id: `place_${i}`,
            name: `Restaurant ${i}`,
            geometry: {
              location: {
                lat: 37.7749 + (Math.random() - 0.5) * 0.01,
                lng: -122.4194 + (Math.random() - 0.5) * 0.01,
              },
            },
            rating: 4.0 + Math.random(),
            user_ratings_total: Math.floor(Math.random() * 1000),
            types: ['restaurant', 'food', 'establishment'],
          })),
        },
      };

      const mockDetailsResponse = {
        data: {
          status: 'OK',
          result: {
            place_id: 'test-place-id',
            name: 'Test Restaurant',
            formatted_address: '123 Test St, San Francisco, CA',
            geometry: {
              location: { lat: 37.7749, lng: -122.4194 },
            },
            rating: 4.5,
            user_ratings_total: 250,
            price_level: 2,
            types: ['restaurant', 'italian_restaurant'],
            formatted_phone_number: '+1 555-123-4567',
            website: 'https://testrestaurant.com',
            opening_hours: { open_now: true },
          },
        },
      };

      // Mock the client methods
      const mockClient = {
        placesNearby: jest.fn().mockResolvedValue(mockPlacesResponse),
        placeDetails: jest.fn().mockResolvedValue(mockDetailsResponse),
      };

      (googleMapsService as any).client = mockClient;

      const startTime = Date.now();
      const results =
        await googleMapsService.searchRestaurants(mockSearchParams);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
      expect(results).toHaveLength(15); // Should return up to 15 results
      expect(mockClient.placesNearby).toHaveBeenCalledTimes(1);
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(15);
    }, 10000); // 10 second test timeout

    test('should handle concurrent requests efficiently', async () => {
      const mockResponse = {
        data: {
          status: 'OK',
          results: [
            {
              place_id: 'test-place-1',
              name: 'Test Restaurant 1',
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
            place_id: 'test-place-1',
            name: 'Test Restaurant 1',
            formatted_address: '123 Test St',
            geometry: { location: { lat: 37.7749, lng: -122.4194 } },
            rating: 4.5,
            user_ratings_total: 100,
            types: ['restaurant'],
          },
        },
      };

      const mockClient = {
        placesNearby: jest.fn().mockResolvedValue(mockResponse),
        placeDetails: jest.fn().mockResolvedValue(mockDetailsResponse),
      };

      (googleMapsService as any).client = mockClient;

      // Make 5 concurrent requests
      const concurrentRequests = Array(5)
        .fill(null)
        .map(() => googleMapsService.searchRestaurants(mockSearchParams));

      const startTime = Date.now();
      const results = await Promise.all(concurrentRequests);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(3000); // Should handle 5 concurrent requests within 3 seconds
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result).toHaveLength(1);
      });
    }, 15000);

    test('should utilize caching for repeated requests', async () => {
      const mockResponse = {
        data: {
          status: 'OK',
          results: [
            {
              place_id: 'cached-place-1',
              name: 'Cached Restaurant',
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
            place_id: 'cached-place-1',
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
        placesNearby: jest.fn().mockResolvedValue(mockResponse),
        placeDetails: jest.fn().mockResolvedValue(mockDetailsResponse),
      };

      (googleMapsService as any).client = mockClient;

      // First request - should hit API
      await googleMapsService.searchRestaurants(mockSearchParams);
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(1);

      // Second request - should use cache
      const startTime = Date.now();
      const cachedResults =
        await googleMapsService.searchRestaurants(mockSearchParams);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100); // Cached request should be very fast
      expect(cachedResults).toHaveLength(1);
      // Should still only be called once due to caching
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(1);
    });
  });

  describe('RestaurantRecommendationService Performance', () => {
    test('should process recommendations in parallel', async () => {
      const mockRestaurants: Restaurant[] = Array.from(
        { length: 20 },
        (_, i) => ({
          placeId: `place_${i}`,
          name: `Restaurant ${i}`,
          address: `${i} Test Street`,
          location: { latitude: 37.7749, longitude: -122.4194 },
          rating: 4.0 + Math.random(),
          userRatingsTotal: Math.floor(Math.random() * 1000),
          priceLevel: Math.floor(Math.random() * 4) + 1,
          cuisineTypes: ['Italian'],
          googleMapsUrl: `https://maps.google.com/place_${i}`,
        })
      );

      const startTime = Date.now();
      const recommendations = await recommendationService.getRecommendations(
        mockRestaurants,
        mockSearchParams
      );
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500); // Should process 20 restaurants within 500ms
      expect(recommendations).toHaveLength(3); // Should return top 3
      expect(recommendations[0].score).toBeGreaterThanOrEqual(
        recommendations[1].score
      );
      expect(recommendations[1].score).toBeGreaterThanOrEqual(
        recommendations[2].score
      );
    });
  });

  describe('BookingService Performance', () => {
    test('should handle booking requests quickly', async () => {
      const mockRestaurant: Restaurant = {
        placeId: 'test-place',
        name: 'Test Restaurant',
        address: '123 Test St',
        location: { latitude: 37.7749, longitude: -122.4194 },
        rating: 4.5,
        userRatingsTotal: 200,
        cuisineTypes: ['Italian'],
        phoneNumber: '+1 555-123-4567',
        website: 'https://testrestaurant.com',
        bookingInfo: {
          reservable: true,
          supportsOnlineBooking: true,
          bookingUrl: 'https://opentable.com/test',
          bookingPlatform: 'opentable',
        },
      };

      const bookingRequest = {
        restaurant: mockRestaurant,
        partySize: 4,
        preferredDateTime: new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString(),
        contactInfo: {
          name: 'John Doe',
          phone: '+1 555-987-6543',
        },
      };

      const startTime = Date.now();
      const result = await bookingService.makeReservation(bookingRequest);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(200); // Booking logic should be very fast
      expect(result.success).toBe(true);
      expect(result.message).toContain('OpenTable');
    });
  });

  describe('End-to-End Performance', () => {
    test('complete search and recommendation flow should finish within 3 seconds', async () => {
      // Mock full flow
      const mockPlacesResponse = {
        data: {
          status: 'OK',
          results: Array.from({ length: 10 }, (_, i) => ({
            place_id: `place_${i}`,
            name: `Restaurant ${i}`,
            geometry: {
              location: {
                lat: 37.7749 + (Math.random() - 0.5) * 0.005,
                lng: -122.4194 + (Math.random() - 0.5) * 0.005,
              },
            },
            rating: 4.0 + Math.random(),
            user_ratings_total: Math.floor(Math.random() * 500) + 50,
            types: ['restaurant', 'food', 'establishment'],
          })),
        },
      };

      const mockDetailsResponse = (placeId: string) => ({
        data: {
          status: 'OK',
          result: {
            place_id: placeId,
            name: `Restaurant ${placeId.split('_')[1]}`,
            formatted_address: `${placeId.split('_')[1]} Test St, San Francisco, CA`,
            geometry: {
              location: {
                lat: 37.7749 + (Math.random() - 0.5) * 0.005,
                lng: -122.4194 + (Math.random() - 0.5) * 0.005,
              },
            },
            rating: 4.0 + Math.random(),
            user_ratings_total: Math.floor(Math.random() * 500) + 50,
            price_level: Math.floor(Math.random() * 4) + 1,
            types: ['restaurant', 'italian_restaurant'],
            formatted_phone_number: '+1 555-123-4567',
            website: 'https://testrestaurant.com',
            opening_hours: { open_now: true },
          },
        },
      });

      const mockClient = {
        placesNearby: jest.fn().mockResolvedValue(mockPlacesResponse),
        placeDetails: jest
          .fn()
          .mockImplementation(({ params }) =>
            Promise.resolve(mockDetailsResponse(params.place_id))
          ),
      };

      (googleMapsService as any).client = mockClient;

      const startTime = Date.now();

      // Execute full flow
      const restaurants =
        await googleMapsService.searchRestaurants(mockSearchParams);
      const recommendations = await recommendationService.getRecommendations(
        restaurants,
        mockSearchParams
      );

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(3000); // Complete flow within 3 seconds
      expect(restaurants.length).toBeGreaterThan(0);
      expect(recommendations).toHaveLength(3);

      // Verify concurrency was used effectively
      expect(mockClient.placesNearby).toHaveBeenCalledTimes(1);
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(10);
    }, 10000);
  });

  describe('Memory Usage Tests', () => {
    test('should not leak memory with large datasets', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Process a large number of restaurants
      const largeRestaurantSet: Restaurant[] = Array.from(
        { length: 100 },
        (_, i) => ({
          placeId: `place_${i}`,
          name: `Restaurant ${i}`,
          address: `${i} Memory Test Street`,
          location: { latitude: 37.7749, longitude: -122.4194 },
          rating: 4.0 + Math.random(),
          userRatingsTotal: Math.floor(Math.random() * 1000),
          priceLevel: Math.floor(Math.random() * 4) + 1,
          cuisineTypes: ['Italian', 'American'],
          reviews: Array.from({ length: 5 }, (_, j) => ({
            authorName: `Reviewer ${j}`,
            rating: Math.floor(Math.random() * 5) + 1,
            text: `This is a review with lots of text to simulate memory usage. Review number ${j} for restaurant ${i}.`,
            time: Date.now(),
          })),
        })
      );

      // Process multiple times to test for memory leaks
      for (let i = 0; i < 10; i++) {
        await recommendationService.getRecommendations(
          largeRestaurantSet,
          mockSearchParams
        );
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 50MB for this test)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });

  describe('Error Handling Performance', () => {
    test('should handle API failures gracefully without blocking', async () => {
      const mockClient = {
        placesNearby: jest.fn().mockResolvedValue({
          data: {
            status: 'OK',
            results: [
              {
                place_id: 'failing-place',
                name: 'Failing Restaurant',
                geometry: { location: { lat: 37.7749, lng: -122.4194 } },
                types: ['restaurant'],
              },
            ],
          },
        }),
        placeDetails: jest.fn().mockRejectedValue(new Error('API Error')),
      };

      (googleMapsService as any).client = mockClient;

      const startTime = Date.now();
      const results =
        await googleMapsService.searchRestaurants(mockSearchParams);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // Should fail fast
      expect(results).toHaveLength(0); // Should return empty array on failures
    });
  });
});
