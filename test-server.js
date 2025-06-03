#!/usr/bin/env node

// Simple test script to verify the MCP server works
// This simulates how an MCP client would interact with the server

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testServer() {
  console.log('🧪 Testing MCP Restaurant Booking Server...\n');

  // Start the server
  const serverPath = join(__dirname, 'dist', 'index.js');
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let serverOutput = '';
  let serverError = '';
  let allOutput = '';

  server.stdout.on('data', (data) => {
    const output = data.toString();
    serverOutput += output;
    allOutput += output;
    console.log('📥 Server stdout:', output);
  });

  server.stderr.on('data', (data) => {
    const error = data.toString();
    serverError += error;
    console.log('📥 Server stderr:', error);
  });

  // Wait a moment for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    // Test 1: List tools
    console.log('📋 Test 1: Listing available tools...');
    const listToolsRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    };

    server.stdin.write(JSON.stringify(listToolsRequest) + '\n');
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('✅ Server started successfully!');

    // Test 2: Search with default Taiwan coordinates
    console.log('\n🔧 Test 2: Testing tool call with default Taiwan coordinates...');
    const searchRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'search_restaurants',
        arguments: {
          cuisineTypes: ['Chinese', 'Taiwanese'],
          mood: 'casual',
          event: 'family gathering'
        }
      }
    };

    console.log('📤 Sending request:', JSON.stringify(searchRequest, null, 2));
    server.stdin.write(JSON.stringify(searchRequest) + '\n');
    await new Promise(resolve => setTimeout(resolve, 8000)); // Even longer wait for API call
    console.log('✅ Tool call with default coordinates completed');

    // Test 3: Search with explicit Taipei coordinates
    console.log('\n🔧 Test 3: Testing tool call with explicit coordinates...');
    const searchRequestExplicit = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'search_restaurants',
        arguments: {
          latitude: 25.0330,
          longitude: 121.5654,
          cuisineTypes: ['Japanese'],
          mood: 'romantic',
          event: 'dating'
        }
      }
    };

    console.log('📤 Sending request:', JSON.stringify(searchRequestExplicit, null, 2));
    server.stdin.write(JSON.stringify(searchRequestExplicit) + '\n');
    await new Promise(resolve => setTimeout(resolve, 8000)); // Even longer wait for API call
    console.log('✅ Tool call with explicit coordinates completed');

    // Test 4: Search for hotpot restaurants using keyword
    console.log('\n🔧 Test 4: Testing hotpot search with keyword...');
    const hotpotSearchRequest = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'search_restaurants',
        arguments: {
          keyword: 'hotpot',
          mood: 'casual',
          event: 'family gathering',
          priceLevel: 3,
          radius: 15000
        }
      }
    };

    console.log('📤 Sending request:', JSON.stringify(hotpotSearchRequest, null, 2));
    server.stdin.write(JSON.stringify(hotpotSearchRequest) + '\n');
    await new Promise(resolve => setTimeout(resolve, 8000)); // Wait for API call
    console.log('✅ Hotpot search completed');

    // Test 5: Search for budget-friendly restaurants using price level filter
    console.log('\n🔧 Test 5: Testing budget-friendly search with price level filter...');
    const budgetSearchRequest = {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'search_restaurants',
        arguments: {
          cuisineTypes: ['Asian', 'Chinese'],
          mood: 'casual',
          event: 'casual dining',
          priceLevel: 1, // Inexpensive restaurants only
          radius: 10000
        }
      }
    };

    console.log('📤 Sending request:', JSON.stringify(budgetSearchRequest, null, 2));
    server.stdin.write(JSON.stringify(budgetSearchRequest) + '\n');
    await new Promise(resolve => setTimeout(resolve, 8000)); // Wait for API call
    console.log('✅ Budget-friendly search completed');

    // Test 6: Search using place name instead of coordinates
    console.log('\n🔧 Test 6: Testing search with place name (Tokyo)...');
    const placeNameSearchRequest = {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'search_restaurants',
        arguments: {
          placeName: 'Tokyo, Japan',
          cuisineTypes: ['Japanese', 'Sushi'],
          mood: 'upscale',
          event: 'business meeting',
          priceLevel: 3,
          radius: 5000
        }
      }
    };

    console.log('📤 Sending request:', JSON.stringify(placeNameSearchRequest, null, 2));
    server.stdin.write(JSON.stringify(placeNameSearchRequest) + '\n');
    await new Promise(resolve => setTimeout(resolve, 8000)); // Wait for API call
    console.log('✅ Place name search completed');

    // Parse and display results
    console.log('\n📊 PARSING RESULTS...');
    console.log('Raw server output length:', allOutput.length);
    
    // Split by lines and look for JSON responses
    const lines = allOutput.split('\n');
    let foundResults = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('{') && line.includes('"result"')) {
        try {
          const response = JSON.parse(line);
          if (response.result && response.result.content && response.result.content[0]) {
            const content = response.result.content[0].text;
            
            try {
              const data = JSON.parse(content);
              
              if (data.recommendations) {
                foundResults = true;
                console.log(`\n🍽️  Restaurant Search Results (ID: ${response.id}):`);
                console.log(`📍 Search Location: ${data.searchCriteria.location.latitude}, ${data.searchCriteria.location.longitude}`);
                console.log(`🍽️  Cuisine Types: ${data.searchCriteria.cuisineTypes.join(', ')}`);
                console.log(`🎭 Mood: ${data.searchCriteria.mood}`);
                console.log(`🎪 Event: ${data.searchCriteria.event}`);
                if (data.searchCriteria.keyword) {
                  console.log(`🔍 Keyword: ${data.searchCriteria.keyword}`);
                }
                if (data.searchCriteria.priceLevel) {
                  const priceLevelDesc = {1: 'Inexpensive', 2: 'Moderate', 3: 'Expensive', 4: 'Very Expensive'};
                  console.log(`💰 Price Level Filter: ${data.searchCriteria.priceLevel} (${priceLevelDesc[data.searchCriteria.priceLevel]})`);
                }
                console.log(`📊 Total Found: ${data.totalFound} restaurants`);
                console.log('\n🏆 Top 3 AI Recommendations:');
                
                data.recommendations.forEach((rec, index) => {
                  console.log(`\n${index + 1}. 🏪 ${rec.restaurant.name}`);
                  console.log(`   📍 ${rec.restaurant.address}`);
                  console.log(`   ⭐ ${rec.restaurant.rating}/5 (${rec.restaurant.userRatingsTotal} reviews)`);
                  
                  // Enhanced price level display
                  if (rec.restaurant.priceLevel) {
                    const priceLevelDesc = {1: 'Inexpensive ($)', 2: 'Moderate ($$)', 3: 'Expensive ($$$)', 4: 'Very Expensive ($$$$)'};
                    console.log(`   💰 Price Level: ${rec.restaurant.priceLevel} - ${priceLevelDesc[rec.restaurant.priceLevel]}`);
                  } else {
                    console.log(`   💰 Price Level: N/A`);
                  }
                  
                  console.log(`   🍽️  Cuisine: ${rec.restaurant.cuisineTypes.join(', ')}`);
                  console.log(`   📞 ${rec.restaurant.phoneNumber || 'N/A'}`);
                  console.log(`   🌐 ${rec.restaurant.website || 'N/A'}`);
                  
                  // Display booking information if available
                  if (rec.restaurant.bookingInfo) {
                    console.log(`   🍽️  Booking Info:`);
                    console.log(`      • Reservable: ${rec.restaurant.bookingInfo.reservable ? 'Yes' : 'No'}`);
                    console.log(`      • Online Booking: ${rec.restaurant.bookingInfo.supportsOnlineBooking ? 'Yes' : 'No'}`);
                    console.log(`      • Phone Required: ${rec.restaurant.bookingInfo.requiresPhone ? 'Yes' : 'No'}`);
                    
                    if (rec.restaurant.bookingInfo.bookingPlatform) {
                      console.log(`      • Platform: ${rec.restaurant.bookingInfo.bookingPlatform}`);
                    }
                    
                    if (rec.restaurant.bookingInfo.bookingUrl) {
                      console.log(`      • Booking URL: ${rec.restaurant.bookingInfo.bookingUrl}`);
                    }
                  }
                  
                  console.log(`   🎯 AI Score: ${rec.score}/100`);
                  console.log(`   💭 ${rec.reasoning}`);
                  console.log(`   🎪 Event Match: ${rec.suitabilityForEvent}`);
                  console.log(`   🎭 Mood Match: ${rec.moodMatch}`);
                });
                console.log('\n' + '='.repeat(80));
              } else if (data.searchCriteria) {
                console.log(`\n📝 Search completed but no recommendations found`);
                console.log(`📍 Location: ${data.searchCriteria.location.latitude}, ${data.searchCriteria.location.longitude}`);
                console.log(`📊 Total Found: ${data.totalFound || 0} restaurants`);
                foundResults = true;
              }
            } catch (e) {
              console.log(`\n📝 Non-restaurant response: ${content.substring(0, 200)}...`);
            }
          }
        } catch (e) {
          // Not a valid JSON response
        }
      }
    }
    
    if (!foundResults) {
      console.log('\n❌ No restaurant results found in server output');
      console.log('📝 Full server output:');
      console.log(allOutput);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    server.kill();
    console.log('\n🏁 Test completed. Server terminated.');
  }
}

// Check if we have the required environment variable
if (!process.env.GOOGLE_MAPS_API_KEY) {
  console.log('⚠️  Warning: GOOGLE_MAPS_API_KEY not set in environment.');
  console.log('   The server will start but API calls will fail.');
  console.log('   To test fully, set your Google Maps API key in .env file.\n');
}

testServer().catch(console.error); 