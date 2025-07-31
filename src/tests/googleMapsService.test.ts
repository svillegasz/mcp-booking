import { GoogleMapsService } from '../services/googleMapsService.js';
import { RestaurantSearchParams } from '../types/index.js';

jest.mock('@googlemaps/google-maps-services-js');

describe('GoogleMapsService', () => {
  let service: GoogleMapsService;
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    service = new GoogleMapsService(mockApiKey);
    jest.clearAllMocks();
  });

  describe('Caching', () => {
    test('should cache restaurant details', async () => {
      const mockDetailsResponse = {
        data: {
          status: 'OK',
          result: {
            place_id: 'test-place',
            name: 'Test Restaurant',
            formatted_address: '123 Test St',
            geometry: { location: { lat: 37.7749, lng: -122.4194 } },
            rating: 4.5,
            user_ratings_total: 100,
            types: ['restaurant'],
          },
        },
      };

      const mockClient = {
        placeDetails: jest.fn().mockResolvedValue(mockDetailsResponse),
      };

      (service as any).client = mockClient;

      // First call
      const result1 = await service.getRestaurantDetails('test-place');
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const result2 = await service.getRestaurantDetails('test-place');
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(1); // Still only 1 call

      expect(result1).toEqual(result2);
    });

    test('should respect cache timeout', async () => {
      const mockDetailsResponse = {
        data: {
          status: 'OK',
          result: {
            place_id: 'test-place',
            name: 'Test Restaurant',
            formatted_address: '123 Test St',
            geometry: { location: { lat: 37.7749, lng: -122.4194 } },
            rating: 4.5,
            user_ratings_total: 100,
            types: ['restaurant'],
          },
        },
      };

      const mockClient = {
        placeDetails: jest.fn().mockResolvedValue(mockDetailsResponse),
      };

      (service as any).client = mockClient;

      // Override cache timeout to 100ms for testing
      (service as any).cacheTimeout = 100;

      // First call
      await service.getRestaurantDetails('test-place');
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(1);

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Second call - should make new API call
      await service.getRestaurantDetails('test-place');
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(2);
    });
  });

  describe('Concurrency Control', () => {
    test('should limit concurrent requests', async () => {
      const mockClient = {
        placeDetails: jest.fn().mockImplementation(({ params }) => {
          return new Promise(resolve => {
            setTimeout(() => {
              resolve({
                data: {
                  status: 'OK',
                  result: {
                    place_id: params.place_id,
                    name: `Restaurant ${params.place_id}`,
                    formatted_address: '123 Test St',
                    geometry: { location: { lat: 37.7749, lng: -122.4194 } },
                    rating: 4.5,
                    user_ratings_total: 100,
                    types: ['restaurant'],
                  },
                },
              });
            }, 100); // 100ms delay
          });
        }),
      };

      (service as any).client = mockClient;

      // Create promises that track execution order
      const executionOrder: string[] = [];
      const promises = Array.from({ length: 15 }, (_, i) => {
        const placeId = `place_${i}`;
        return (service as any).getRestaurantDetails(placeId).then(() => {
          executionOrder.push(placeId);
        });
      });

      const startTime = Date.now();
      await Promise.all(promises);
      const duration = Date.now() - startTime;

      // With concurrency limit of 10, and 100ms per request, it should take ~200ms
      // (15 requests / 10 concurrent = 2 batches, 2 * 100ms = 200ms)
      expect(duration).toBeLessThan(400); // Allow some buffer
      expect(executionOrder).toHaveLength(15);
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(15);
    });
  });

  describe('Distance Filtering', () => {
    test('should pre-filter results by distance', async () => {
      const mockPlacesResponse = {
        data: {
          status: 'OK',
          results: [
            {
              place_id: 'near_place',
              name: 'Near Restaurant',
              geometry: {
                location: {
                  lat: 37.7749, // Same as search location
                  lng: -122.4194,
                },
              },
              types: ['restaurant'],
            },
            {
              place_id: 'far_place',
              name: 'Far Restaurant',
              geometry: {
                location: {
                  lat: 37.8749, // ~11km away
                  lng: -122.4194,
                },
              },
              types: ['restaurant'],
            },
          ],
        },
      };

      const mockDetailsResponse = (placeId: string) => ({
        data: {
          status: 'OK',
          result: {
            place_id: placeId,
            name: `Restaurant ${placeId}`,
            formatted_address: '123 Test St',
            geometry: {
              location:
                placeId === 'near_place'
                  ? { lat: 37.7749, lng: -122.4194 }
                  : { lat: 37.8749, lng: -122.4194 },
            },
            rating: 4.5,
            user_ratings_total: 100,
            types: ['restaurant'],
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

      (service as any).client = mockClient;

      const searchParams: RestaurantSearchParams = {
        location: { latitude: 37.7749, longitude: -122.4194 },
        cuisineTypes: [],
        mood: '',
        event: '',
        radius: 5000, // 5km radius
      };

      const results = await service.searchRestaurants(searchParams);

      // Only the near restaurant should be returned
      expect(results).toHaveLength(1);
      expect(results[0].placeId).toBe('near_place');

      // Should only call placeDetails for the near restaurant due to pre-filtering
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(1);
    });
  });

  describe('Request Deduplication', () => {
    test('should deduplicate simultaneous requests for same place', async () => {
      let callCount = 0;
      const mockClient = {
        placeDetails: jest.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            data: {
              status: 'OK',
              result: {
                place_id: 'duplicate-place',
                name: 'Test Restaurant',
                formatted_address: '123 Test St',
                geometry: { location: { lat: 37.7749, lng: -122.4194 } },
                rating: 4.5,
                user_ratings_total: 100,
                types: ['restaurant'],
              },
            },
          });
        }),
      };

      (service as any).client = mockClient;

      // Make 5 simultaneous requests for the same place
      const promises = Array(5)
        .fill(null)
        .map(() => service.getRestaurantDetails('duplicate-place'));

      const results = await Promise.all(promises);

      // Should only make one actual API call due to deduplication
      expect(callCount).toBe(1);
      expect(mockClient.placeDetails).toHaveBeenCalledTimes(1);

      // All results should be identical
      results.forEach(result => {
        expect(result?.placeId).toBe('duplicate-place');
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle API errors gracefully', async () => {
      const mockClient = {
        placeDetails: jest.fn().mockRejectedValue(new Error('API Error')),
      };

      (service as any).client = mockClient;

      const result = await service.getRestaurantDetails('error-place');
      expect(result).toBeNull();
    });

    test('should handle invalid API responses', async () => {
      const mockClient = {
        placeDetails: jest.fn().mockResolvedValue({
          data: {
            status: 'NOT_FOUND',
            result: null,
          },
        }),
      };

      (service as any).client = mockClient;

      const result = await service.getRestaurantDetails('invalid-place');
      expect(result).toBeNull();
    });
  });

  describe('Field Optimization', () => {
    test('should request minimal fields for basic search', async () => {
      const mockClient = {
        placeDetails: jest.fn().mockResolvedValue({
          data: {
            status: 'OK',
            result: {
              place_id: 'test-place',
              name: 'Test Restaurant',
              formatted_address: '123 Test St',
              geometry: { location: { lat: 37.7749, lng: -122.4194 } },
              rating: 4.5,
              user_ratings_total: 100,
              types: ['restaurant'],
            },
          },
        }),
      };

      (service as any).client = mockClient;

      await service.getRestaurantDetails('test-place', 'en', false);

      const callArgs = mockClient.placeDetails.mock.calls[0][0];
      const requestedFields = callArgs.params.fields;

      // Should not include extended fields like reviews, detailed opening hours
      expect(requestedFields).not.toContain('reviews');
      expect(requestedFields).not.toContain('opening_hours');
      expect(requestedFields).toContain('place_id');
      expect(requestedFields).toContain('name');
    });

    test('should request extended fields when specified', async () => {
      const mockClient = {
        placeDetails: jest.fn().mockResolvedValue({
          data: {
            status: 'OK',
            result: {
              place_id: 'test-place',
              name: 'Test Restaurant',
              formatted_address: '123 Test St',
              geometry: { location: { lat: 37.7749, lng: -122.4194 } },
              rating: 4.5,
              user_ratings_total: 100,
              types: ['restaurant'],
              reviews: [],
              opening_hours: { weekday_text: [] },
            },
          },
        }),
      };

      (service as any).client = mockClient;

      await service.getRestaurantDetails('test-place', 'en', true);

      const callArgs = mockClient.placeDetails.mock.calls[0][0];
      const requestedFields = callArgs.params.fields;

      // Should include extended fields
      expect(requestedFields).toContain('reviews');
      expect(requestedFields).toContain('opening_hours');
    });
  });

  describe('Performance Monitoring', () => {
    test('should track request times', () => {
      const service = new GoogleMapsService('test-key');

      // Access private method for testing
      (service as any).recordRequestTime(100);
      (service as any).recordRequestTime(200);
      (service as any).recordRequestTime(150);

      const metrics = service.getPerformanceMetrics();
      expect(metrics.averageRequestTime).toBe(150);
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.maxRequestTimeSamples).toBe(100); // Default value
      expect(metrics.currentSampleCount).toBe(3);
    });

    test('should respect custom maxRequestTimeSamples configuration', () => {
      const service = new GoogleMapsService('test-key', {
        maxRequestTimeSamples: 5,
      });

      // Add more samples than the configured limit
      for (let i = 1; i <= 8; i++) {
        (service as any).recordRequestTime(i * 10);
      }

      const metrics = service.getPerformanceMetrics();
      expect(metrics.maxRequestTimeSamples).toBe(5);
      expect(metrics.currentSampleCount).toBe(5); // Should be limited to 5
      expect(metrics.totalRequests).toBe(5); // Only keeps last 5 samples
    });

    test('should respect custom cache and circuit breaker configuration', () => {
      const service = new GoogleMapsService('test-key', {
        cacheTimeout: 10000, // 10 seconds
        circuitBreakerThreshold: 3,
        maxRequestTimeSamples: 50,
      });

      const metrics = service.getPerformanceMetrics();
      expect(metrics.maxRequestTimeSamples).toBe(50);

      // Verify internal configuration (access private properties for testing)
      expect((service as any).cacheTimeout).toBe(10000);
      expect((service as any).circuitBreakerThreshold).toBe(3);
    });
  });
});
