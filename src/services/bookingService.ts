import { Restaurant, BookingRequest, BookingResponse } from "../types/index.js";

export class BookingService {
  /**
   * Attempt to make a reservation at the specified restaurant
   * Note: This is a mock implementation. Real-world implementation would require
   * integration with restaurant-specific booking systems or third-party services
   * like OpenTable, Resy, etc.
   */
  async makeReservation(request: BookingRequest): Promise<BookingResponse> {
    try {
      // Validate the booking request
      const validation = this.validateBookingRequest(request);
      if (!validation.isValid) {
        return {
          success: false,
          message: validation.message || "Invalid booking request",
        };
      }

      // Check if restaurant has booking information
      const { restaurant } = request;
      if (restaurant.bookingInfo) {
        // If online booking is available, provide direct booking guidance
        if (
          restaurant.bookingInfo.supportsOnlineBooking &&
          restaurant.bookingInfo.bookingUrl
        ) {
          return this.handleOnlineBooking(request);
        }

        // If only phone booking is available
        if (
          restaurant.bookingInfo.requiresPhone &&
          !restaurant.bookingInfo.supportsOnlineBooking
        ) {
          return this.handlePhoneOnlyBooking(request);
        }

        // If restaurant doesn't accept reservations
        if (!restaurant.bookingInfo.reservable) {
          return this.handleWalkInOnly(request);
        }
      }

      // Fallback to mock booking logic for restaurants without booking info
      const bookingResult = await this.processBooking(request);

      return bookingResult;
    } catch (error) {
      console.error("Error making reservation:", error);
      return {
        success: false,
        message: `Failed to make reservation: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Handle online booking platforms
   */
  private handleOnlineBooking(request: BookingRequest): BookingResponse {
    const { restaurant } = request;
    const { bookingInfo } = restaurant;

    if (!bookingInfo?.bookingUrl) {
      return {
        success: false,
        message: "Booking URL not available",
      };
    }

    const platformName = this.getPlatformDisplayName(
      bookingInfo.bookingPlatform
    );
    const date = new Date(request.preferredDateTime);
    const formattedDate = date.toLocaleDateString();
    const formattedTime = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    return {
      success: true,
      message: `Please complete your reservation online via ${platformName}`,
      confirmationDetails: `
Online Reservation Required
---------------------------
Restaurant: ${restaurant.name}
Platform: ${platformName}
Booking URL: ${bookingInfo.bookingUrl}

Reservation Details:
• Date: ${formattedDate}
• Time: ${formattedTime}
• Party Size: ${request.partySize} ${request.partySize === 1 ? "person" : "people"}
• Contact: ${request.contactInfo.name} (${request.contactInfo.phone})
${request.specialRequests ? `• Special Requests: ${request.specialRequests}` : ""}

Next Steps:
1. Click the booking URL above
2. Select your preferred date and time
3. Complete the reservation form
4. You'll receive confirmation via email

💡 Tip: Have your party details and special requests ready when booking online.
      `.trim(),
    };
  }

  /**
   * Handle phone-only booking
   */
  private handlePhoneOnlyBooking(request: BookingRequest): BookingResponse {
    const { restaurant } = request;
    const date = new Date(request.preferredDateTime);
    const formattedDate = date.toLocaleDateString();
    const formattedTime = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    return {
      success: true,
      message: "This restaurant requires phone reservations",
      confirmationDetails: `
Phone Reservation Required
--------------------------
Restaurant: ${restaurant.name}
Phone: ${restaurant.phoneNumber || "Contact restaurant directly"}

Reservation Details to Mention:
• Date: ${formattedDate}
• Time: ${formattedTime}
• Party Size: ${request.partySize} ${request.partySize === 1 ? "person" : "people"}
• Contact: ${request.contactInfo.name} (${request.contactInfo.phone})
${request.specialRequests ? `• Special Requests: ${request.specialRequests}` : ""}

💡 Tips for calling:
• Call during business hours for best response
• Have alternative dates/times ready
• Mention any dietary restrictions or special occasions
• Ask about cancellation policy
      `.trim(),
    };
  }

  /**
   * Handle walk-in only restaurants
   */
  private handleWalkInOnly(request: BookingRequest): BookingResponse {
    const { restaurant } = request;
    const date = new Date(request.preferredDateTime);
    const formattedDate = date.toLocaleDateString();
    const formattedTime = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    return {
      success: true,
      message: "This restaurant operates on a walk-in basis only",
      confirmationDetails: `
Walk-In Only Restaurant
-----------------------
Restaurant: ${restaurant.name}
Address: ${restaurant.address}

Your Planned Visit:
• Date: ${formattedDate}
• Time: ${formattedTime}
• Party Size: ${request.partySize} ${request.partySize === 1 ? "person" : "people"}

💡 Walk-In Tips:
• Arrive early, especially during peak hours (6-8 PM)
• Consider visiting during off-peak times for shorter waits
• Call ahead to check current wait times: ${restaurant.phoneNumber || "Contact restaurant"}
• Be flexible with seating arrangements
${
  restaurant.openingHours?.openNow !== undefined
    ? `• Current Status: ${restaurant.openingHours.openNow ? "Open" : "Closed"}`
    : ""
}

⚠️ Note: Wait times may vary, especially on weekends and holidays.
      `.trim(),
    };
  }

  /**
   * Get display name for booking platform
   */
  private getPlatformDisplayName(platform?: string): string {
    switch (platform) {
      case "opentable":
        return "OpenTable";
      case "resy":
        return "Resy";
      case "yelp":
        return "Yelp Reservations";
      case "google_reserve":
        return "Google Reserve";
      case "restaurant_website":
        return "Restaurant Website";
      default:
        return "Online Booking Platform";
    }
  }

  /**
   * Get booking instructions for a restaurant
   */
  async getBookingInstructions(restaurant: Restaurant): Promise<string> {
    const instructions: string[] = [];

    // Check if we have booking information from Google Places
    if (restaurant.bookingInfo) {
      const { bookingInfo } = restaurant;

      if (bookingInfo.supportsOnlineBooking && bookingInfo.bookingUrl) {
        // Provide platform-specific instructions
        switch (bookingInfo.bookingPlatform) {
          case "opentable":
            instructions.push(`🍽️ **Book Online via OpenTable**`);
            instructions.push(`   Visit: ${bookingInfo.bookingUrl}`);
            instructions.push(`   ✅ Instant confirmation available`);
            instructions.push(`   ✅ Easy cancellation and modification`);
            break;

          case "resy":
            instructions.push(`🍽️ **Book Online via Resy**`);
            instructions.push(`   Visit: ${bookingInfo.bookingUrl}`);
            instructions.push(`   ✅ Real-time availability`);
            instructions.push(`   ✅ Premium dining experiences available`);
            break;

          case "yelp":
            instructions.push(`🍽️ **Book Online via Yelp Reservations**`);
            instructions.push(`   Visit: ${bookingInfo.bookingUrl}`);
            instructions.push(`   ✅ Integrated with restaurant reviews`);
            break;

          case "google_reserve":
            instructions.push(`🍽️ **Book Online via Google Reserve**`);
            instructions.push(`   Visit: ${bookingInfo.bookingUrl}`);
            instructions.push(`   ✅ Integrated with Google Maps`);
            break;

          case "restaurant_website":
            instructions.push(`🍽️ **Book Online via Restaurant Website**`);
            instructions.push(`   Visit: ${bookingInfo.bookingUrl}`);
            instructions.push(`   ✅ Direct booking with restaurant`);
            instructions.push(
              `   ✅ May offer exclusive deals or menu options`
            );
            break;

          case "other":
            instructions.push(`🌐 **Online Booking Available**`);
            instructions.push(`   Visit: ${bookingInfo.bookingUrl}`);
            instructions.push(`   💡 Check website for reservation system`);
            break;
        }
        instructions.push(""); // Add spacing
      }

      // Add phone booking option if available
      if (restaurant.phoneNumber) {
        if (bookingInfo.requiresPhone && !bookingInfo.supportsOnlineBooking) {
          instructions.push(`📞 **Call to Make Reservation (Required)**`);
          instructions.push(`   Phone: ${restaurant.phoneNumber}`);
          instructions.push(
            `   ⚠️ Online booking not available - phone reservations only`
          );
        } else {
          instructions.push(`📞 **Alternative: Call for Reservation**`);
          instructions.push(`   Phone: ${restaurant.phoneNumber}`);
          instructions.push(
            `   💡 Useful for special requests or large parties`
          );
        }
        instructions.push(""); // Add spacing
      }

      // Add booking recommendations based on restaurant info
      if (!bookingInfo.reservable) {
        instructions.push(`ℹ️ **Walk-in Only**`);
        instructions.push(`   This restaurant may not accept reservations`);
        instructions.push(`   💡 Consider arriving early during peak hours`);
      }
    } else {
      // Fallback to original logic if no booking info available
      if (restaurant.phoneNumber) {
        instructions.push(
          `📞 Call ${restaurant.phoneNumber} to make a reservation`
        );
      }

      if (restaurant.website) {
        instructions.push(
          `🌐 Visit ${restaurant.website} for online reservations`
        );
      }
    }

    // Add general booking advice
    instructions.push("💡 **General Tips:**");
    instructions.push(
      "   • Consider calling ahead, especially for peak dining times"
    );

    if (restaurant.rating >= 4.5) {
      instructions.push(
        "   • ⭐ This is a highly-rated restaurant - reservations are strongly recommended"
      );
    }

    if (restaurant.priceLevel && restaurant.priceLevel >= 3) {
      instructions.push(
        "   • 💰 Fine dining establishment - advance reservations recommended"
      );
    }

    // Add opening hours information
    if (restaurant.openingHours?.weekdayText) {
      instructions.push("\n📅 **Opening Hours:**");
      restaurant.openingHours.weekdayText.forEach(hours => {
        instructions.push(`   ${hours}`);
      });
    }

    // Add current status if available
    if (restaurant.openingHours?.openNow !== undefined) {
      const status = restaurant.openingHours.openNow
        ? "🟢 Currently Open"
        : "🔴 Currently Closed";
      instructions.push(`\n${status}`);
    }

    return instructions.join("\n");
  }

  /**
   * Check availability for a restaurant (mock implementation)
   */
  async checkAvailability(
    restaurant: Restaurant,
    dateTime: string,
    partySize: number
  ): Promise<{
    available: boolean;
    message: string;
    alternativeTimes?: string[];
  }> {
    // Mock availability check
    const requestedDate = new Date(dateTime);
    const now = new Date();

    // Check if the date is in the past
    if (requestedDate < now) {
      return {
        available: false,
        message: "Cannot make reservations for past dates",
      };
    }

    // Check if the date is too far in the future (most restaurants don't take reservations more than 30 days out)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(now.getDate() + 30);

    if (requestedDate > thirtyDaysFromNow) {
      return {
        available: false,
        message:
          "Reservations are typically not available more than 30 days in advance",
      };
    }

    // Mock availability based on restaurant rating and time
    const hour = requestedDate.getHours();
    const isWeekend =
      requestedDate.getDay() === 0 || requestedDate.getDay() === 6;
    const isPeakTime = hour >= 18 && hour <= 20; // 6-8 PM

    // High-rated restaurants are harder to book during peak times
    const availabilityChance =
      restaurant.rating >= 4.5 && isPeakTime && isWeekend ? 0.3 : 0.8;
    const isAvailable = Math.random() < availabilityChance;

    if (isAvailable) {
      return {
        available: true,
        message: "Table appears to be available for your requested time",
      };
    } else {
      // Generate alternative times
      const alternatives: string[] = [];
      const baseTime = new Date(requestedDate);

      // Suggest times 1 hour earlier and later
      const earlierTime = new Date(baseTime);
      earlierTime.setHours(baseTime.getHours() - 1);
      alternatives.push(earlierTime.toISOString());

      const laterTime = new Date(baseTime);
      laterTime.setHours(baseTime.getHours() + 1);
      alternatives.push(laterTime.toISOString());

      return {
        available: false,
        message:
          "Your requested time may not be available. Consider these alternative times:",
        alternativeTimes: alternatives,
      };
    }
  }

  /**
   * Validate booking request
   */
  private validateBookingRequest(request: BookingRequest): {
    isValid: boolean;
    message?: string;
  } {
    // Check party size
    if (request.partySize < 1 || request.partySize > 20) {
      return {
        isValid: false,
        message: "Party size must be between 1 and 20 people",
      };
    }

    // Check date format
    try {
      const requestedDate = new Date(request.preferredDateTime);
      if (isNaN(requestedDate.getTime())) {
        return {
          isValid: false,
          message: "Invalid date format. Please use ISO date string.",
        };
      }
    } catch {
      return {
        isValid: false,
        message: "Invalid date format. Please use ISO date string.",
      };
    }

    // Check contact info
    if (!request.contactInfo.name || !request.contactInfo.phone) {
      return {
        isValid: false,
        message: "Name and phone number are required for reservations",
      };
    }

    // Validate phone number format (basic check)
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    if (
      !phoneRegex.test(request.contactInfo.phone.replace(/[\s\-\(\)]/g, ""))
    ) {
      return {
        isValid: false,
        message: "Please provide a valid phone number",
      };
    }

    return { isValid: true };
  }

  /**
   * Process the actual booking (mock implementation)
   */
  private async processBooking(
    request: BookingRequest
  ): Promise<BookingResponse> {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Mock booking success/failure
    const successRate = 0.85; // 85% success rate
    const isSuccessful = Math.random() < successRate;

    if (isSuccessful) {
      const bookingId = this.generateBookingId();
      const confirmationDetails = this.generateConfirmationDetails(
        request,
        bookingId
      );

      return {
        success: true,
        bookingId,
        confirmationDetails,
        message: "Reservation successfully created!",
      };
    } else {
      // Check availability for alternative suggestions
      const availability = await this.checkAvailability(
        request.restaurant,
        request.preferredDateTime,
        request.partySize
      );

      return {
        success: false,
        message:
          "Unable to confirm reservation at requested time. Please try calling the restaurant directly.",
        alternativeOptions: availability.alternativeTimes
          ? [request.restaurant]
          : undefined,
      };
    }
  }

  /**
   * Generate a mock booking ID
   */
  private generateBookingId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `RES-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Generate confirmation details
   */
  private generateConfirmationDetails(
    request: BookingRequest,
    bookingId: string
  ): string {
    const date = new Date(request.preferredDateTime);
    const formattedDate = date.toLocaleDateString();
    const formattedTime = date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    return `
Reservation Confirmation
------------------------
Booking ID: ${bookingId}
Restaurant: ${request.restaurant.name}
Address: ${request.restaurant.address}
Date: ${formattedDate}
Time: ${formattedTime}
Party Size: ${request.partySize} ${request.partySize === 1 ? "person" : "people"}
Name: ${request.contactInfo.name}
Phone: ${request.contactInfo.phone}
${request.specialRequests ? `Special Requests: ${request.specialRequests}` : ""}

Please arrive on time and bring a valid ID.
For changes or cancellations, please call the restaurant directly.
${request.restaurant.phoneNumber ? `Restaurant Phone: ${request.restaurant.phoneNumber}` : ""}
    `.trim();
  }
}
