import { Pool } from 'pg';
import dotenv from 'dotenv';
import logger from './logger';

// Check if we're running on server
const isServer = typeof window === 'undefined';

// Load environment variables
if (isServer) {
    dotenv.config();
}

// Track initialization state
let isInitialized = false;
let isInitializing = false;
let initPromise = null;

class Database {
    constructor() {
        this.pool = null;
        this.connectionCount = 0;
        this.lastActivity = Date.now();
        this.maxConnectionIdleTime = 20 * 60 * 1000; // 20 minutes
        this.connectionMonitorInterval = null;
    }

    getPool() {
        if (!this.pool && isServer) {
            // Configure database connection with proper SSL settings for Render
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                // Always use SSL for Render databases
                ssl: {
                    rejectUnauthorized: false
                },
                user: process.env.PGUSER || 'leads_db_rc6a_user',
                host: process.env.PGHOST || 'dpg-cvo56ap5pdvs739nroe0-a.oregon-postgres.render.com',
                database: process.env.PGDATABASE || 'leads_db_rc6a',
                password: process.env.PGPASSWORD || '4kzEQqPy5bLBpA1pNiQVGA7VT5KeOcgT',
                port: process.env.PGPORT || 5432,
                max: 10, // Maximum number of clients
                idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
                connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
                maxUses: 7500, // Close and replace connections after 7500 queries
            });

            // Set up event handlers
            this.pool.on('error', (err, client) => {
                logger.error(`Unexpected error on idle client: ${err.message}`);
            });

            // Set up connection monitor
            this.startConnectionMonitor();

            logger.info('Database pool created with SSL enabled');
        }
        return this.pool;
    }

    startConnectionMonitor() {
        if (isServer && !this.connectionMonitorInterval) {
            this.connectionMonitorInterval = setInterval(() => {
                const now = Date.now();
                if (now - this.lastActivity > this.maxConnectionIdleTime) {
                    logger.info('Closing idle database connections');
                    this.closeConnections();
                }
            }, 5 * 60 * 1000); // Check every 5 minutes
        }
    }

    closeConnections() {
        if (this.pool) {
            this.pool.end();
            this.pool = null;
        }
    }

    async init() {
        // Don't initialize on the client side
        if (!isServer) {
            return;
        }

        if (isInitialized) {
            return;
        }

        if (isInitializing) {
            // If initialization is already in progress, wait for it to complete
            return initPromise;
        }

        isInitializing = true;
        initPromise = this._init();

        try {
            await initPromise;
            isInitialized = true;

            // Force check and add missing columns
            await this.ensureRequiredColumns();
        } finally {
            isInitializing = false;
        }

        return initPromise;
    }

    /**
     * Ensure all required columns exist in the database
     */
    async ensureRequiredColumns() {
        try {
            // Check for params column in scraping_tasks
            const paramsExists = await this.getOne(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name='scraping_tasks' AND column_name='params'
                ) as exists
            `);

            if (!paramsExists || !paramsExists.exists) {
                logger.info('Adding params column to scraping_tasks table');
                await this.query(`ALTER TABLE scraping_tasks ADD COLUMN params TEXT`);
            }

            // Check for limit column in scraping_tasks (using double quotes to handle reserved keyword)
            const limitExists = await this.getOne(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name='scraping_tasks' AND column_name='limit'
                ) as exists
            `);

            if (!limitExists || !limitExists.exists) {
                logger.info('Adding "limit" column to scraping_tasks table');
                await this.query(`ALTER TABLE scraping_tasks ADD COLUMN "limit" INTEGER DEFAULT 100`);
            }
        } catch (error) {
            logger.error(`Error ensuring required columns: ${error.message}`);
        }
    }

    async _init() {
        try {
            logger.info('Initializing database...');
            await this.testConnection();
            await this.initTables();
            logger.info('Database initialized successfully');
        } catch (error) {
            logger.error(`Failed to initialize database: ${error.message}`);
            throw error;
        }
    }

    async testConnection() {
        const pool = this.getPool();
        try {
            await pool.query('SELECT NOW()');
            logger.info('Database connection successful');
            return true;
        } catch (error) {
            logger.error(`Database connection error: ${error.message}`);
            throw error; // Re-throw to be handled by caller
        }
    }

    async initTables() {
        try {
            const pool = this.getPool();
            // Initialize tables here if needed
            // Example:
            await pool.query(`
                CREATE TABLE IF NOT EXISTS categories (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) UNIQUE NOT NULL,
                    description TEXT,
                    usage_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Initialize other tables as needed

        } catch (error) {
            logger.error(`Error initializing tables: ${error.message}`);
            throw error;
        }
    }

    async query(text, params, retries = 3) {
        this.lastActivity = Date.now();
        const pool = this.getPool();

        try {
            const result = await pool.query(text, params);
            return result;
        } catch (error) {
            // If we get a connection error and have retries left, retry
            if (retries > 0 && (
                error.code === 'ECONNREFUSED' ||
                error.code === 'ETIMEDOUT' ||
                error.message.includes('connect ETIMEDOUT') ||
                error.message.includes('Connection terminated') ||
                error.message.includes('Connection reset by peer')
            )) {
                logger.error(`Database query error (retries left: ${retries}): ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.query(text, params, retries - 1);
            }

            logger.error(`Database query error: ${error.message}`);
            throw error;
        }
    }

    async getOne(text, params) {
        const result = await this.query(text, params);
        return result.rows[0];
    }

    async getMany(text, params) {
        const result = await this.query(text, params);
        return result.rows;
    }

    async getCount(table, whereClause = '', params = []) {
        try {
            // Build a proper count query
            const countQuery = `
                SELECT COUNT(*) as count 
                FROM ${table}
                ${whereClause ? `WHERE ${whereClause}` : ''}
            `;

            const result = await this.query(countQuery, params);
            return parseInt(result.rows[0]?.count || '0');
        } catch (error) {
            logger.error(`Error getting count: ${error.message}`);
            return 0;
        }
    }

    /**
     * Create a table specifically for keyword search results if it doesn't exist
     * @param {string} keyword - Keyword to create table for
     * @returns {Promise<boolean>} Whether the table was created
     */
    async ensureKeywordTable(keyword) {
        try {
            // Generate a safe table name from the keyword
            const tableName = this.getKeywordTableName(keyword);
            
            // Check if table exists
            const tableExists = await this.getOne(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = $1
                ) as exists
            `, [tableName]);

            if (tableExists && tableExists.exists) {
                logger.debug(`Table for '${keyword}' already exists: ${tableName}`);
                return false;
            }

            logger.info(`Creating table for keyword '${keyword}': ${tableName}`);

            await this.query(`
                CREATE TABLE ${tableName} (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    address TEXT,
                    city VARCHAR(100),
                    state VARCHAR(100),
                    country VARCHAR(100),
                    postal_code VARCHAR(20),
                    phone VARCHAR(50),
                    email VARCHAR(255),
                    website VARCHAR(255),
                    domain VARCHAR(255),
                    rating NUMERIC(3,1),
                    search_location VARCHAR(255),
                    batch_id VARCHAR(36),
                    task_id VARCHAR(36),
                    business_type VARCHAR(100),
                    owner_name VARCHAR(255),
                    verified BOOLEAN DEFAULT FALSE,
                    contacted BOOLEAN DEFAULT FALSE,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);

            // Create helpful indexes
            await this.query(`
                CREATE INDEX idx_${tableName}_state ON ${tableName}(state);
                CREATE INDEX idx_${tableName}_city ON ${tableName}(city);
                CREATE INDEX idx_${tableName}_batch_id ON ${tableName}(batch_id);
                CREATE INDEX idx_${tableName}_email_exists ON ${tableName}((CASE WHEN email IS NOT NULL AND email != '' THEN true ELSE false END));
                CREATE INDEX idx_${tableName}_website_exists ON ${tableName}((CASE WHEN website IS NOT NULL AND website != '' THEN true ELSE false END));
            `);

            logger.info(`Table for keyword '${keyword}' created successfully: ${tableName}`);
            return true;
        } catch (error) {
            logger.error(`Error creating keyword table for '${keyword}': ${error.message}`);
            return false;
        }
    }

    /**
     * Generate a safe table name for a keyword
     * @param {string} keyword - Original keyword
     * @returns {string} Safe SQL table name
     */
    getKeywordTableName(keyword) {
        // Convert keyword to lowercase
        let safeName = keyword.toLowerCase();
        
        // Replace spaces and special chars with underscores
        safeName = safeName.replace(/[^a-z0-9]/g, '_');
        
        // Remove consecutive underscores
        safeName = safeName.replace(/_+/g, '_');
        
        // Remove leading/trailing underscores
        safeName = safeName.replace(/^_|_$/g, '');
        
        // Ensure it starts with a letter (required for PostgreSQL)
        if (!/^[a-z]/.test(safeName)) {
            safeName = 'kw_' + safeName;
        }
        
        // Add prefix to avoid conflicts with system tables
        safeName = 'leads_' + safeName;
        
        // Truncate if too long (PostgreSQL has 63 char limit)
        if (safeName.length > 60) {
            safeName = safeName.substring(0, 60);
        }
        
        return safeName;
    }

    /**
     * Get all keyword-specific tables in the database
     * @returns {Promise<Array>} List of keyword tables
     */
    async getKeywordTables() {
        try {
            const result = await this.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_name LIKE 'leads_%' 
                AND table_schema = 'public'
                ORDER BY table_name
            `);
            
            return result.rows.map(row => row.table_name);
        } catch (error) {
            logger.error(`Error getting keyword tables: ${error.message}`);
            return [];
        }
    }

    /**
     * Get top cities for a specific state
     * @param {string} state - State code (e.g. 'CA', 'NY')
     * @param {number} limit - Maximum number of cities to return
     * @returns {Promise<Array>} Array of city objects with name and population
     */
    async getTopCitiesForState(state, limit = 10) {
        try {
            // First ensure the city_data table exists
            await this.ensureCityDataTable();
            
            // Try to get cities from the city_data table
            const citiesQuery = `
                SELECT city, population 
                FROM city_data 
                WHERE state_code = $1 
                ORDER BY population DESC 
                LIMIT $2
            `;
            
            const citiesResult = await this.getMany(citiesQuery, [state, limit]);
            
            // If we have cities in the database, return them
            if (citiesResult && citiesResult.length > 0) {
                return citiesResult;
            }
            
            // Otherwise return hardcoded top cities
            logger.info(`No cities found in database for ${state}, using hardcoded data`);
            return this.getHardcodedTopCities(state, limit);
        } catch (error) {
            logger.error(`Error getting top cities for ${state}: ${error.message}`);
            // Fallback to hardcoded cities
            return this.getHardcodedTopCities(state, limit);
        }
    }
    
    /**
     * Get hardcoded top cities for common states
     * @param {string} state - State code
     * @param {number} limit - Maximum number of cities to return
     * @returns {Array} Array of city objects
     */
    getHardcodedTopCities(state, limit = 10) {
        // Map of states to their top cities by population
        const topCitiesByState = {
            'AL': ['Birmingham', 'Montgomery', 'Huntsville', 'Mobile', 'Tuscaloosa', 'Hoover', 'Dothan', 'Auburn', 'Decatur', 'Madison'],
            'AK': ['Anchorage', 'Fairbanks', 'Juneau', 'Sitka', 'Ketchikan', 'Wasilla', 'Kenai', 'Kodiak', 'Bethel', 'Palmer'],
            'AZ': ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Glendale', 'Gilbert', 'Tempe', 'Peoria', 'Surprise'],
            'AR': ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro', 'North Little Rock', 'Conway', 'Rogers', 'Pine Bluff', 'Bentonville'],
            'CA': ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Fresno', 'Sacramento', 'Long Beach', 'Oakland', 'Bakersfield', 'Anaheim'],
            'CO': ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Arvada', 'Westminster', 'Pueblo', 'Centennial'],
            'CT': ['Bridgeport', 'New Haven', 'Stamford', 'Hartford', 'Waterbury', 'Norwalk', 'Danbury', 'New Britain', 'Bristol', 'Meriden'],
            'DE': ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Smyrna', 'Milford', 'Seaford', 'Georgetown', 'Elsmere', 'New Castle'],
            'FL': ['Jacksonville', 'Miami', 'Tampa', 'Orlando', 'St. Petersburg', 'Hialeah', 'Tallahassee', 'Fort Lauderdale', 'Port St. Lucie', 'Cape Coral'],
            'GA': ['Atlanta', 'Augusta', 'Columbus', 'Macon', 'Savannah', 'Athens', 'Sandy Springs', 'Roswell', 'Johns Creek', 'Albany'],
            'HI': ['Honolulu', 'East Honolulu', 'Pearl City', 'Hilo', 'Kailua', 'Waipahu', 'Kaneohe', 'Mililani Town', 'Kahului', 'Kihei'],
            'ID': ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Pocatello', 'Caldwell', 'Coeur d\'Alene', 'Twin Falls', 'Post Falls', 'Lewiston'],
            'IL': ['Chicago', 'Aurora', 'Joliet', 'Naperville', 'Rockford', 'Springfield', 'Elgin', 'Peoria', 'Champaign', 'Waukegan'],
            'IN': ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Fishers', 'Bloomington', 'Hammond', 'Gary', 'Lafayette'],
            'IA': ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City', 'Waterloo', 'Council Bluffs', 'Ames', 'West Des Moines', 'Ankeny'],
            'KS': ['Wichita', 'Overland Park', 'Kansas City', 'Olathe', 'Topeka', 'Lawrence', 'Shawnee', 'Manhattan', 'Lenexa', 'Salina'],
            'KY': ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington', 'Richmond', 'Georgetown', 'Florence', 'Hopkinsville', 'Nicholasville'],
            'LA': ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette', 'Lake Charles', 'Kenner', 'Bossier City', 'Monroe', 'Alexandria', 'Houma'],
            'ME': ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn', 'Biddeford', 'Sanford', 'Saco', 'Augusta', 'Westbrook'],
            'MD': ['Baltimore', 'Frederick', 'Rockville', 'Gaithersburg', 'Bowie', 'Hagerstown', 'Annapolis', 'College Park', 'Salisbury', 'Laurel'],
            'MA': ['Boston', 'Worcester', 'Springfield', 'Lowell', 'Cambridge', 'New Bedford', 'Brockton', 'Quincy', 'Lynn', 'Fall River'],
            'MI': ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Ann Arbor', 'Lansing', 'Flint', 'Dearborn', 'Livonia', 'Westland'],
            'MN': ['Minneapolis', 'St. Paul', 'Rochester', 'Bloomington', 'Duluth', 'Brooklyn Park', 'Plymouth', 'Maple Grove', 'Woodbury', 'St. Cloud'],
            'MS': ['Jackson', 'Gulfport', 'Southaven', 'Hattiesburg', 'Biloxi', 'Meridian', 'Tupelo', 'Olive Branch', 'Greenville', 'Horn Lake'],
            'MO': ['Kansas City', 'St. Louis', 'Springfield', 'Columbia', 'Independence', 'Lee\'s Summit', 'O\'Fallon', 'St. Joseph', 'St. Charles', 'St. Peters'],
            'MT': ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte', 'Helena', 'Kalispell', 'Havre', 'Anaconda', 'Miles City'],
            'NE': ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island', 'Kearney', 'Fremont', 'Hastings', 'Norfolk', 'Columbus', 'North Platte'],
            'NV': ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks', 'Carson City', 'Fernley', 'Elko', 'Mesquite', 'Boulder City'],
            'NH': ['Manchester', 'Nashua', 'Concord', 'Derry', 'Dover', 'Rochester', 'Salem', 'Merrimack', 'Londonderry', 'Hudson'],
            'NJ': ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Clifton', 'Trenton', 'Camden', 'Passaic', 'Union City', 'Bayonne'],
            'NM': ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Santa Fe', 'Roswell', 'Farmington', 'Alamogordo', 'Clovis', 'Hobbs', 'Carlsbad'],
            'NY': ['New York', 'Buffalo', 'Rochester', 'Yonkers', 'Syracuse', 'Albany', 'New Rochelle', 'Mount Vernon', 'Schenectady', 'Utica'],
            'NC': ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Fayetteville', 'Cary', 'Wilmington', 'High Point', 'Concord'],
            'ND': ['Fargo', 'Bismarck', 'Grand Forks', 'Minot', 'West Fargo', 'Williston', 'Dickinson', 'Mandan', 'Jamestown', 'Wahpeton'],
            'OH': ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Parma', 'Canton', 'Youngstown', 'Lorain'],
            'OK': ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Lawton', 'Edmond', 'Moore', 'Midwest City', 'Enid', 'Stillwater'],
            'OR': ['Portland', 'Salem', 'Eugene', 'Gresham', 'Hillsboro', 'Beaverton', 'Bend', 'Medford', 'Springfield', 'Corvallis'],
            'PA': ['Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Reading', 'Scranton', 'Bethlehem', 'Lancaster', 'Harrisburg', 'Altoona'],
            'RI': ['Providence', 'Warwick', 'Cranston', 'Pawtucket', 'East Providence', 'Woonsocket', 'Coventry', 'Cumberland', 'North Providence', 'South Kingstown'],
            'SC': ['Columbia', 'Charleston', 'North Charleston', 'Mount Pleasant', 'Rock Hill', 'Greenville', 'Summerville', 'Spartanburg', 'Goose Creek', 'Hilton Head Island'],
            'SD': ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings', 'Watertown', 'Mitchell', 'Yankton', 'Pierre', 'Huron', 'Vermillion'],
            'TN': ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Franklin', 'Jackson', 'Johnson City', 'Bartlett'],
            'TX': ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Laredo'],
            'UT': ['Salt Lake City', 'West Valley City', 'Provo', 'West Jordan', 'Orem', 'Sandy', 'Ogden', 'St. George', 'Layton', 'South Jordan'],
            'VT': ['Burlington', 'Rutland', 'Essex Junction', 'South Burlington', 'Bennington', 'Barre', 'Montpelier', 'Winooski', 'St. Albans', 'Newport'],
            'VA': ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Richmond', 'Newport News', 'Alexandria', 'Hampton', 'Roanoke', 'Portsmouth', 'Suffolk'],
            'WA': ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Kent', 'Everett', 'Renton', 'Yakima', 'Federal Way'],
            'WV': ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling', 'Weirton', 'Fairmont', 'Martinsburg', 'Beckley', 'Clarksburg'],
            'WI': ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Oshkosh', 'Eau Claire', 'West Allis'],
            'WY': ['Cheyenne', 'Casper', 'Laramie', 'Gillette', 'Rock Springs', 'Sheridan', 'Green River', 'Evanston', 'Riverton', 'Cody']
        };
        
        // Normalize state code to uppercase
        const stateCode = state.toUpperCase();
        
        // Get cities for the state or return an empty array if state not found
        const cities = topCitiesByState[stateCode] || [];
        
        // Return cities with population property (mocked based on city position)
        return cities.slice(0, limit).map((city, index) => ({
            city,
            population: 1000000 - (index * 50000) // Mock population data
        }));
    }
    
    /**
     * Ensure the city_data table exists in the database
     */
    async ensureCityDataTable() {
        try {
            // Check if table exists
            const tableExists = await this.getOne(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'city_data'
                ) as exists
            `);
            
            let tableCreated = false;
            
            if (!tableExists || !tableExists.exists) {
                logger.info('Creating city_data table');
                
                await this.query(`
                    CREATE TABLE city_data (
                        id SERIAL PRIMARY KEY,
                        city VARCHAR(100) NOT NULL,
                        state VARCHAR(100),
                        state_code VARCHAR(2),
                        population INTEGER,
                        latitude NUMERIC(10,6),
                        longitude NUMERIC(10,6),
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                `);
                
                // Create indexes
                await this.query(`
                    CREATE INDEX idx_city_data_state_code ON city_data(state_code);
                    CREATE INDEX idx_city_data_population ON city_data(population DESC);
                `);
                
                logger.info('city_data table created successfully');
                tableCreated = true;
            }
            
            // Check if the table has data
            const hasData = await this.getOne(`
                SELECT COUNT(*) as count FROM city_data
            `);
            
            // If the table was just created or is empty, populate it
            if (tableCreated || parseInt(hasData?.count || '0') === 0) {
                logger.info('Populating city_data table with initial data');
                await this.populateCityData();
            }
            
            return true;
        } catch (error) {
            logger.error(`Error ensuring city_data table: ${error.message}`);
            return false;
        }
    }

    /**
     * Populate the city_data table with hardcoded city data
     */
    async populateCityData() {
        try {
            const states = await this.getAllStates();
            let insertCount = 0;
            
            logger.info('Starting to populate city_data table');
            
            // For each state, add its top cities
            for (const state of states) {
                const stateCode = state.code;
                const cities = this.getHardcodedTopCities(stateCode, 10);
                
                if (cities.length > 0) {
                    // Generate values for bulk insert
                    const values = cities.map((city, index) => 
                        `('${city.city.replace(/'/g, "''")}', '${state.name.replace(/'/g, "''")}', '${stateCode}', ${city.population || 1000000 - (index * 50000)}, ${index === 0 ? 'NULL' : 'NULL'}, ${index === 0 ? 'NULL' : 'NULL'}, NOW())`
                    ).join(',');
                    
                    // Insert cities for this state
                    await this.query(`
                        INSERT INTO city_data 
                        (city, state, state_code, population, latitude, longitude, created_at)
                        VALUES ${values}
                        ON CONFLICT DO NOTHING
                    `);
                    
                    insertCount += cities.length;
                    logger.debug(`Added ${cities.length} cities for ${stateCode}`);
                }
            }
            
            logger.info(`Successfully populated city_data table with ${insertCount} cities`);
            return insertCount;
        } catch (error) {
            logger.error(`Error populating city_data: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get all states with their 2-letter codes
     * @returns {Promise<Array>} Array of state objects with code and name
     */
    async getAllStates() {
        // Return hardcoded list of states
        return [
            {code: 'AL', name: 'Alabama'},
            {code: 'AK', name: 'Alaska'},
            {code: 'AZ', name: 'Arizona'},
            {code: 'AR', name: 'Arkansas'},
            {code: 'CA', name: 'California'},
            {code: 'CO', name: 'Colorado'},
            {code: 'CT', name: 'Connecticut'},
            {code: 'DE', name: 'Delaware'},
            {code: 'FL', name: 'Florida'},
            {code: 'GA', name: 'Georgia'},
            {code: 'HI', name: 'Hawaii'},
            {code: 'ID', name: 'Idaho'},
            {code: 'IL', name: 'Illinois'},
            {code: 'IN', name: 'Indiana'},
            {code: 'IA', name: 'Iowa'},
            {code: 'KS', name: 'Kansas'},
            {code: 'KY', name: 'Kentucky'},
            {code: 'LA', name: 'Louisiana'},
            {code: 'ME', name: 'Maine'},
            {code: 'MD', name: 'Maryland'},
            {code: 'MA', name: 'Massachusetts'},
            {code: 'MI', name: 'Michigan'},
            {code: 'MN', name: 'Minnesota'},
            {code: 'MS', name: 'Mississippi'},
            {code: 'MO', name: 'Missouri'},
            {code: 'MT', name: 'Montana'},
            {code: 'NE', name: 'Nebraska'},
            {code: 'NV', name: 'Nevada'},
            {code: 'NH', name: 'New Hampshire'},
            {code: 'NJ', name: 'New Jersey'},
            {code: 'NM', name: 'New Mexico'},
            {code: 'NY', name: 'New York'},
            {code: 'NC', name: 'North Carolina'},
            {code: 'ND', name: 'North Dakota'},
            {code: 'OH', name: 'Ohio'},
            {code: 'OK', name: 'Oklahoma'},
            {code: 'OR', name: 'Oregon'},
            {code: 'PA', name: 'Pennsylvania'},
            {code: 'RI', name: 'Rhode Island'},
            {code: 'SC', name: 'South Carolina'},
            {code: 'SD', name: 'South Dakota'},
            {code: 'TN', name: 'Tennessee'},
            {code: 'TX', name: 'Texas'},
            {code: 'UT', name: 'Utah'},
            {code: 'VT', name: 'Vermont'},
            {code: 'VA', name: 'Virginia'},
            {code: 'WA', name: 'Washington'},
            {code: 'WV', name: 'West Virginia'},
            {code: 'WI', name: 'Wisconsin'},
            {code: 'WY', name: 'Wyoming'}
        ];
    }

    /**
     * Format a phone number to contain only digits with leading '1' for US/Canada
     * @param {string} phone - Phone number to format
     * @returns {string|null} Formatted phone number or null if input is invalid
     */
    formatPhoneNumber(phone) {
        if (!phone) return null;
        
        try {
            // Remove all non-digit characters
            let formatted = phone.replace(/[^0-9]/g, '');
            
            // Ensure US/Canada numbers have leading 1
            if (formatted.length === 10) {
                formatted = '1' + formatted;
            } else if (formatted.length > 10 && !formatted.startsWith('1')) {
                // Add leading 1 if missing for international numbers
                formatted = '1' + formatted;
            }
            
            return formatted;
        } catch (error) {
            logger.warn(`Error formatting phone number: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Create or update a business listing with automatic phone formatting
     * @param {Object} data - Business data
     * @returns {Promise<Object>} - Created or updated business
     */
    async saveBusinessListing(data) {
        try {
            // Format the phone number if present
            if (data.phone) {
                data.formatted_phone = this.formatPhoneNumber(data.phone);
            }
            
            // Determine if this is an update or insert
            if (data.id) {
                // Update existing record
                const result = await this.query(
                    `UPDATE business_listings 
                    SET name = $1, address = $2, city = $3, state = $4,
                        phone = $5, formatted_phone = $6, email = $7, website = $8,
                        updated_at = NOW()
                    WHERE id = $9
                    RETURNING *`,
                    [
                        data.name, data.address, data.city, data.state,
                        data.phone, data.formatted_phone, data.email, data.website,
                        data.id
                    ]
                );
                return result.rows[0];
            } else {
                // Insert new record
                const result = await this.query(
                    `INSERT INTO business_listings
                    (name, address, city, state, phone, formatted_phone, email, website, search_term, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
                    RETURNING *`,
                    [
                        data.name, data.address, data.city, data.state,
                        data.phone, data.formatted_phone, data.email, data.website, 
                        data.search_term || 'manual'
                    ]
                );
                return result.rows[0];
            }
        } catch (error) {
            logger.error(`Error saving business listing: ${error.message}`);
            throw error;
        }
    }
}

// Create a singleton instance
const db = new Database();

// Export the service
export default db;