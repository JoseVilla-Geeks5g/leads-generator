import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';

// Cache for commonly accessed states to reduce database load
const cityCache = {
  data: {},
  timestamp: 0,
  maxAge: 30 * 60 * 1000 // 30 minutes
};

export async function GET(request) {
  try {
    await db.init();

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const state = searchParams.get('state');

    if (!state) {
      return NextResponse.json({ 
        cities: [],
        message: 'State parameter is required'
      });
    }

    // Check if we have cached data for this state
    const now = Date.now();
    const cacheKey = `cities_${state}`;
    
    if (cityCache.data[cacheKey] && (now - cityCache.timestamp) < cityCache.maxAge) {
      return NextResponse.json({ cities: cityCache.data[cacheKey] });
    }

    // Query the database for cities in the state
    const citiesResult = await db.getMany(`
      SELECT DISTINCT city 
      FROM business_listings 
      WHERE state = $1 AND city IS NOT NULL AND city != ''
      ORDER BY city
    `, [state]);

    const cities = citiesResult.map(row => row.city);

    // Cache the results
    cityCache.data[cacheKey] = cities;
    cityCache.timestamp = now;

    return NextResponse.json({ cities });
  } catch (error) {
    logger.error(`Error fetching cities: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to fetch cities', details: error.message },
      { status: 500 }
    );
  }
}
