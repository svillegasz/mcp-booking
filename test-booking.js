#!/usr/bin/env node

// Test script for enhanced booking features
// This simulates how an MCP client would interact with the booking functionality

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testBookingFeatures() {
  console.log('🧪 Testing Enhanced Booking Features...\n');

  // Start the server
  const serverPath = join(__dirname, 'dist', 'index.js');
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let allOutput = '';

  server.stdout.on('data', (data) => {
    const output = data.toString();
    allOutput += output;
    console.log('📥 Server stdout:', output.trim());
  });

  server.stderr.on('data', (data) => {
    console.log('📥 Server stderr:', data.toString().trim());
  });

  try {
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    // Test 1: Get booking instructions for a restaurant
    console.log('\n🔧 Test 1: Getting booking instructions...');
    const bookingInstructionsRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_booking_instructions',
        arguments: {
          placeId: 'ChIJNcI8zFIXaTQRFCTYsuvo55E' // Fenghe Taiwanese Restaurant
        }
      }
    };

    console.log('📤 Sending request:', JSON.stringify(bookingInstructionsRequest, null, 2));
    server.stdin.write(JSON.stringify(bookingInstructionsRequest) + '\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Test 2: Make a reservation
    console.log('\n🔧 Test 2: Making a reservation...');
    const makeReservationRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'make_reservation',
        arguments: {
          placeId: 'ChIJNcI8zFIXaTQRFCTYsuvo55E',
          partySize: 4,
          preferredDateTime: '2025-02-15T19:00:00',
          contactName: 'John Doe',
          contactPhone: '+886-912-345-678',
          contactEmail: 'john.doe@example.com',
          specialRequests: 'Window seat preferred, celebrating anniversary'
        }
      }
    };

    console.log('📤 Sending request:', JSON.stringify(makeReservationRequest, null, 2));
    server.stdin.write(JSON.stringify(makeReservationRequest) + '\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Test 3: Check availability
    console.log('\n🔧 Test 3: Checking availability...');
    const checkAvailabilityRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'check_availability',
        arguments: {
          placeId: 'ChIJNcI8zFIXaTQRFCTYsuvo55E',
          dateTime: '2025-02-15T19:00:00',
          partySize: 4
        }
      }
    };

    console.log('📤 Sending request:', JSON.stringify(checkAvailabilityRequest, null, 2));
    server.stdin.write(JSON.stringify(checkAvailabilityRequest) + '\n');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Parse and display results
    console.log('\n📊 PARSING BOOKING RESULTS...');
    const lines = allOutput.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('{') && line.includes('"result"')) {
        try {
          const response = JSON.parse(line);
          if (response.result && response.result.content && response.result.content[0]) {
            const content = response.result.content[0].text;
            
            console.log(`\n📋 Response for ID ${response.id}:`);
            console.log('='.repeat(60));
            
            // Special handling for restaurant details (Test 0) to show booking data
            if (response.id === 0) {
              console.log('🔍 RAW GOOGLE API BOOKING DATA:');
              console.log('='.repeat(60));
              
              try {
                const restaurantData = JSON.parse(content);
                
                console.log('📍 Restaurant Name:', restaurantData.name);
                console.log('🌐 Website:', restaurantData.website || 'Not provided');
                console.log('📞 Phone:', restaurantData.phoneNumber || 'Not provided');
                console.log('🏷️ Place Types:', restaurantData.cuisineTypes?.join(', ') || 'Not provided');
                console.log('⭐ Rating:', restaurantData.rating || 'Not provided');
                console.log('👥 Total Reviews:', restaurantData.userRatingsTotal || 'Not provided');
                console.log('💰 Price Level:', restaurantData.priceLevel || 'Not provided');
                
                if (restaurantData.bookingInfo) {
                  console.log('\n🎯 ANALYZED BOOKING INFORMATION:');
                  console.log(JSON.stringify(restaurantData.bookingInfo, null, 2));
                }
                
                if (restaurantData.openingHours) {
                  console.log('\n🕒 OPENING HOURS:');
                  console.log('   • Currently Open:', restaurantData.openingHours.openNow);
                  if (restaurantData.openingHours.weekdayText) {
                    console.log('   • Schedule:');
                    restaurantData.openingHours.weekdayText.forEach(day => {
                      console.log('     -', day);
                    });
                  }
                }
                
                console.log('\n📊 COMPLETE RESTAURANT DATA (Pretty Printed):');
                console.log(JSON.stringify(restaurantData, null, 2));
                
                console.log('\n📋 GOOGLE PLACES API FIELDS USED FOR BOOKING:');
                console.log('   • website: Used to detect booking platforms (OpenTable, Resy, etc.)');
                console.log('   • formatted_phone_number: Used for phone reservations');
                console.log('   • opening_hours: Used to show availability times');
                console.log('   • types: Used to determine restaurant category');
                console.log('   • rating & user_ratings_total: Used for recommendation scoring');
                
              } catch (parseError) {
                console.log('Raw content (not JSON):');
                console.log(content);
              }
            } else {
              // Pretty print other responses if they're JSON
              try {
                const jsonData = JSON.parse(content);
                console.log(JSON.stringify(jsonData, null, 2));
              } catch (parseError) {
                console.log(content);
              }
            }
            console.log('='.repeat(60));
          }
        } catch (e) {
          // Not a valid JSON response
        }
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    server.kill();
    console.log('\n🏁 Booking test completed. Server terminated.');
  }
}

// Check if we have the required environment variable
if (!process.env.GOOGLE_MAPS_API_KEY) {
  console.log('⚠️  Warning: GOOGLE_MAPS_API_KEY not set in environment.');
  console.log('   The server will start but API calls will fail.');
  console.log('   To test fully, set your Google Maps API key in .env file.\n');
}

testBookingFeatures().catch(console.error); 