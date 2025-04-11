import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

export async function GET() {
  try {
    // Initialize database if needed
    await db.init();
    
    // Ensure the city_data table exists
    await db.ensureCityDataTable();
    
    // Get all states with hardcoded fallback
    const states = await db.getAllStates();
    
    // Create a response object with state data and city information
    const stateData = {};
    
    // For each state, get top cities (will use hardcoded data if city_data table is empty)
    for (const state of states) {
      try {
        const topCities = await db.getTopCitiesForState(state.code, 10);
        stateData[state.code] = {
          name: state.name,
          code: state.code,
          cities: topCities.map(city => city.city)
        };
      } catch (error) {
        // Fall back to hardcoded cities for this state
        const hardcodedCities = db.getHardcodedTopCities(state.code, 10);
        stateData[state.code] = {
          name: state.name,
          code: state.code,
          cities: hardcodedCities.map(city => city.city)
        };
        logger.warn(`Using hardcoded cities for ${state.code}: ${error.message}`);
      }
    }
    
    return NextResponse.json(stateData);
  } catch (error) {
    logger.error(`Error getting states data: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to get states data', details: error.message },
      { status: 500 }
    );
  }
}
