#!/usr/bin/env node

/**
 * Performance Benchmark Script
 * Measures actual performance improvements after optimizations
 */

import { GoogleMapsService } from '../services/googleMapsService.js';
import { RestaurantRecommendationService } from '../services/restaurantRecommendationService.js';
import { RestaurantSearchParams, Restaurant } from '../types/index.js';

// Simple mock function implementation for standalone execution
interface MockFunction {
  (...args: any[]): any;
  mock: {
    calls: any[][];
  };
  mockClear: () => void;
  mockImplementation: (fn: (...args: any[]) => any) => MockFunction;
}

const createMockFunction = (): MockFunction => {
  const calls: any[][] = [];
  let implementation: ((...args: any[]) => any) | null = null;

  const mockFn = ((...args: any[]) => {
    calls.push(args);
    return implementation ? implementation(...args) : undefined;
  }) as MockFunction;

  mockFn.mock = { calls };
  mockFn.mockClear = () => {
    calls.length = 0;
  };
  mockFn.mockImplementation = (fn: (...args: any[]) => any) => {
    implementation = fn;
    return mockFn;
  };

  return mockFn;
};

// Mock the Google Maps client for consistent benchmarking
const createMockClient = (responseDelay: number = 50) => ({
  placesNearby: createMockFunction().mockImplementation(
    () =>
      new Promise(resolve =>
        setTimeout(
          () =>
            resolve({
              data: {
                status: 'OK',
                results: Array.from({ length: 15 }, (_, i) => ({
                  place_id: `bench_place_${i}`,
                  name: `Benchmark Restaurant ${i}`,
                  geometry: {
                    location: {
                      lat: 37.7749 + (Math.random() - 0.5) * 0.01,
                      lng: -122.4194 + (Math.random() - 0.5) * 0.01,
                    },
                  },
                  rating: 3.5 + Math.random() * 1.5,
                  user_ratings_total: Math.floor(Math.random() * 500) + 50,
                  types: ['restaurant', 'food'],
                })),
              },
            }),
          responseDelay
        )
      )
  ),
  placeDetails: createMockFunction().mockImplementation(
    ({ params }) =>
      new Promise(resolve =>
        setTimeout(
          () =>
            resolve({
              data: {
                status: 'OK',
                result: {
                  place_id: params.place_id,
                  name: `Restaurant ${params.place_id.split('_')[2]}`,
                  formatted_address: '123 Benchmark St, San Francisco, CA',
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
                    Math.random() > 0.5
                      ? 'italian_restaurant'
                      : 'japanese_restaurant',
                  ],
                  formatted_phone_number: '+1 555-123-4567',
                  website: 'https://benchmark-restaurant.com',
                  opening_hours: { open_now: true },
                },
              },
            }),
          responseDelay
        )
      )
  ),
});

const searchParams: RestaurantSearchParams = {
  location: { latitude: 37.7749, longitude: -122.4194 },
  cuisineTypes: ['Italian', 'Japanese'],
  mood: 'romantic',
  event: 'dating',
  radius: 2000,
  locale: 'en',
};

async function benchmarkSearchPerformance() {
  console.log('🚀 Starting Restaurant Search Performance Benchmark\n');

  const googleMapsService = new GoogleMapsService('test-api-key');
  const recommendationService = new RestaurantRecommendationService();

  // Test different scenarios
  const scenarios = [
    { name: 'Fast API (50ms latency)', delay: 50 },
    { name: 'Normal API (150ms latency)', delay: 150 },
    { name: 'Slow API (300ms latency)', delay: 300 },
  ];

  for (const scenario of scenarios) {
    console.log(`\n📊 Testing: ${scenario.name}`);
    console.log('='.repeat(50));

    const mockClient = createMockClient(scenario.delay);
    (googleMapsService as any).client = mockClient;

    // Warm up (to establish caches, etc.)
    await googleMapsService.searchRestaurants(searchParams);
    mockClient.placesNearby.mockClear();
    mockClient.placeDetails.mockClear();

    // Run benchmark
    const iterations = 5;
    const timings: number[] = [];
    const restaurants: Restaurant[][] = [];

    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();

      const searchResults =
        await googleMapsService.searchRestaurants(searchParams);
      const recommendations = await recommendationService.getRecommendations(
        searchResults,
        searchParams
      );

      const endTime = performance.now();
      const duration = endTime - startTime;

      timings.push(duration);
      restaurants.push(searchResults);

      console.log(
        `  Run ${i + 1}: ${duration.toFixed(2)}ms (${searchResults.length} restaurants, ${recommendations.length} recommendations)`
      );
    }

    // Calculate statistics
    const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    const minTime = Math.min(...timings);
    const maxTime = Math.max(...timings);
    const medianTime = timings.sort((a, b) => a - b)[
      Math.floor(timings.length / 2)
    ];

    console.log(`\n  📈 Statistics:`);
    console.log(`     Average: ${avgTime.toFixed(2)}ms`);
    console.log(`     Median:  ${medianTime.toFixed(2)}ms`);
    console.log(`     Min:     ${minTime.toFixed(2)}ms`);
    console.log(`     Max:     ${maxTime.toFixed(2)}ms`);
    console.log(
      `     Std Dev: ${calculateStandardDeviation(timings).toFixed(2)}ms`
    );

    // API call analysis
    const totalPlaceDetailsCalls = mockClient.placeDetails.mock.calls.length;
    const totalPlacesNearbyCalls = mockClient.placesNearby.mock.calls.length;

    console.log(`\n  🔍 API Usage:`);
    console.log(`     Places Nearby calls: ${totalPlacesNearbyCalls}`);
    console.log(`     Place Details calls: ${totalPlaceDetailsCalls}`);
    console.log(
      `     Total API calls: ${totalPlacesNearbyCalls + totalPlaceDetailsCalls}`
    );

    // Performance targets
    const passesTarget = avgTime < 2000; // 2 second target
    console.log(
      `\n  🎯 Performance Target (< 2000ms): ${passesTarget ? '✅ PASS' : '❌ FAIL'}`
    );
  }
}

async function benchmarkConcurrency() {
  console.log('\n\n🔄 Testing Concurrent Request Performance\n');

  const googleMapsService = new GoogleMapsService('test-api-key');
  const mockClient = createMockClient(100); // 100ms API delay
  (googleMapsService as any).client = mockClient;

  const concurrentLevels = [1, 3, 5, 10];

  for (const concurrency of concurrentLevels) {
    console.log(`\n📊 Testing: ${concurrency} Concurrent Requests`);
    console.log('-'.repeat(40));

    const startTime = performance.now();

    const promises = Array(concurrency)
      .fill(null)
      .map(() => googleMapsService.searchRestaurants(searchParams));

    const results = await Promise.all(promises);
    const endTime = performance.now();
    const duration = endTime - startTime;

    console.log(`  Duration: ${duration.toFixed(2)}ms`);
    console.log(`  Per request: ${(duration / concurrency).toFixed(2)}ms`);
    console.log(
      `  Total results: ${results.reduce((sum, r) => sum + r.length, 0)}`
    );

    // Efficiency calculation
    const theoreticalSequentialTime = concurrency * 100 * 15; // concurrency * API delay * typical detail calls
    const efficiency = (theoreticalSequentialTime / duration) * 100;
    console.log(`  Efficiency: ${efficiency.toFixed(1)}% (vs sequential)`);
  }
}

async function benchmarkMemoryUsage() {
  console.log('\n\n💾 Testing Memory Usage\n');

  const googleMapsService = new GoogleMapsService('test-api-key');
  const recommendationService = new RestaurantRecommendationService();
  const mockClient = createMockClient(50);
  (googleMapsService as any).client = mockClient;

  // Force garbage collection if available
  if (global.gc) global.gc();

  const initialMemory = process.memoryUsage();
  console.log(
    `Initial Memory: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`
  );

  // Perform multiple operations
  const operations = 20;
  for (let i = 0; i < operations; i++) {
    const results = await googleMapsService.searchRestaurants({
      ...searchParams,
      location: {
        latitude: 37.7749 + i * 0.001,
        longitude: -122.4194 + i * 0.001,
      },
    });

    await recommendationService.getRecommendations(results, searchParams);

    if (i % 5 === 0) {
      const currentMemory = process.memoryUsage();
      console.log(
        `After ${i + 1} operations: ${(currentMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`
      );
    }
  }

  // Force garbage collection and measure final memory
  if (global.gc) global.gc();

  const finalMemory = process.memoryUsage();
  const memoryIncrease =
    (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;

  console.log(
    `\nFinal Memory: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`
  );
  console.log(`Memory Increase: ${memoryIncrease.toFixed(2)}MB`);
  console.log(
    `Memory per Operation: ${(memoryIncrease / operations).toFixed(3)}MB`
  );

  const passesMemoryTarget = memoryIncrease < 50; // 50MB max increase
  console.log(
    `Memory Target (< 50MB): ${passesMemoryTarget ? '✅ PASS' : '❌ FAIL'}`
  );
}

function calculateStandardDeviation(values: number[]): number {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(value => Math.pow(value - avg, 2));
  const avgSquaredDiff =
    squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;
  return Math.sqrt(avgSquaredDiff);
}

async function runBenchmarks() {
  try {
    console.log('🎯 Restaurant Search Service Performance Benchmarks');
    console.log('='.repeat(60));

    await benchmarkSearchPerformance();
    await benchmarkConcurrency();
    await benchmarkMemoryUsage();

    console.log('\n✅ Benchmark completed successfully!');
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runBenchmarks();
}

export { runBenchmarks };
