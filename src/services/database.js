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

    async getTopCitiesForState(state, limit = 10) {
        try {
            // First ensure the city_data table exists
            await this.ensureCityDataTable();
            
            // For California, don't apply a limit - get all cities
            const isCA = state.toUpperCase() === 'CA';
            
            // Try to get cities from the city_data table
            const citiesQuery = `
                SELECT city, population 
                FROM city_data 
                WHERE state_code = $1 
                ORDER BY population DESC 
                ${isCA ? '' : 'LIMIT $2'}
            `;
            
            // Use different parameter count based on whether we're limiting or not
            const citiesResult = isCA ? 
                await this.getMany(citiesQuery, [state]) : 
                await this.getMany(citiesQuery, [state, limit]);
            
            // If we have cities in the database, return them
            if (citiesResult && citiesResult.length > 0) {
                return citiesResult;
            }
            
            // Otherwise return hardcoded top cities
            logger.info(`No cities found in database for ${state}, using hardcoded data`);
            
            // For California, get all hardcoded cities without limit
            return this.getHardcodedTopCities(state, isCA ? 1000 : limit);
        } catch (error) {
            logger.error(`Error getting top cities for ${state}: ${error.message}`);
            // Fallback to hardcoded cities
            return this.getHardcodedTopCities(state, state.toUpperCase() === 'CA' ? 1000 : limit);
        }
    }
    
    getHardcodedTopCities(state, limit = 10) {
        // Map of states to their top cities by population
        const topCitiesByState = {
            'AL': ['Birmingham', 'Montgomery', 'Huntsville', 'Mobile', 'Tuscaloosa', 'Hoover', 'Dothan', 'Auburn', 'Decatur', 'Madison', 'Florence', 'Vestavia Hills', 'Phenix City', 'Prattville', 'Gadsden', 'Alabaster', 'Opelika', 'Enterprise', 'Bessemer', 'Homewood', 'Athens', 'Anniston', 'Northport', 'Pelham', 'Oxford', 'Albertville', 'Daphne', 'Trussville', 'Selma', 'Mountain Brook', 'Talladega', 'Fairhope', 'Helena', 'Center Point', 'Troy', 'Millbrook', 'Hueytown', 'Jasper', 'Scottsboro', 'Foley', 'Gulf Shores', 'Alexander City', 'Cullman', 'Prichard', 'Ozark', 'Hartselle', 'Russellville', 'Pell City', 'Saraland', 'Muscle Shoals'],
            'AK': ['Anchorage', 'Fairbanks', 'Juneau', 'Sitka', 'Ketchikan', 'Wasilla', 'Kenai', 'Kodiak', 'Bethel', 'Palmer', 'Homer', 'Unalaska', 'Barrow', 'Soldotna', 'Valdez', 'Nome', 'Kotzebue', 'Seward', 'Wrangell', 'Dillingham', 'Cordova', 'North Pole', 'Houston', 'Petersburg', 'Haines', 'Craig', 'Delta Junction', 'Hooper Bay', 'Akutan', 'Sand Point', 'King Cove', 'Chevak', 'Skagway', 'Tok', 'Emmonak', 'Mountain Village', 'Kwethluk', 'Toksook Bay', 'Togiak', 'Aniak', 'Unalakleet', 'Saint Mary\'s', 'Hoonah', 'Selawik', 'Klawock', 'Alakanuk', 'Fort Yukon', 'Galena', 'Gambell', 'Kake'],
            'AZ': ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Glendale', 'Gilbert', 'Tempe', 'Peoria', 'Surprise', 'San Tan Valley', 'Yuma', 'Avondale', 'Goodyear', 'Flagstaff', 'Buckeye', 'Lake Havasu City', 'Casa Grande', 'Sierra Vista', 'Maricopa', 'Oro Valley', 'Prescott', 'Bullhead City', 'Prescott Valley', 'Apache Junction', 'Marana', 'El Mirage', 'Queen Creek', 'Florence', 'Sahuarita', 'Kingman', 'Fountain Hills', 'Nogales', 'Douglas', 'Payson', 'Eloy', 'Paradise Valley', 'Somerton', 'Globe', 'Safford', 'Show Low', 'Cottonwood', 'Sedona', 'Winslow', 'Chino Valley', 'Page', 'Camp Verde', 'Coolidge', 'Wickenburg', 'Benson'],
            'AR': ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale', 'Jonesboro', 'North Little Rock', 'Conway', 'Rogers', 'Pine Bluff', 'Bentonville', 'Hot Springs', 'Benton', 'Texarkana', 'Sherwood', 'Jacksonville', 'Russellville', 'Bella Vista', 'Cabot', 'West Memphis', 'Paragould', 'Siloam Springs', 'Bryant', 'Searcy', 'Van Buren', 'El Dorado', 'Maumelle', 'Blytheville', 'Harrison', 'Mountain Home', 'Marion', 'Camden', 'Magnolia', 'Arkadelphia', 'Batesville', 'Hope', 'Monticello', 'Clarksville', 'Farmington', 'Greenwood', 'Osceola', 'Lowell', 'Beebe', 'Morrilton', 'Malvern', 'Stuttgart', 'Wynne', 'Forrest City', 'Nashville', 'Newport', 'De Queen'],
            'CA': ['Los Angeles', 'San Diego', 'San Jose', 'San Francisco', 'Fresno', 'Sacramento', 'Long Beach', 'Oakland', 'Bakersfield', 'Anaheim', 'Santa Ana', 'Riverside', 'Stockton', 'Chula Vista', 'Fremont', 'Irvine', 'San Bernardino', 'Modesto', 'Oxnard', 'Fontana', 'Moreno Valley', 'Glendale', 'Huntington Beach', 'Santa Clarita', 'Garden Grove', 'Santa Rosa', 'Oceanside', 'Rancho Cucamonga', 'Ontario', 'Lancaster', 'Elk Grove', 'Palmdale', 'Corona', 'Salinas', 'Pomona', 'Torrance', 'Hayward', 'Escondido', 'Sunnyvale', 'Pasadena', 'Orange', 'Fullerton', 'Thousand Oaks', 'Visalia', 'Simi Valley', 'Concord', 'Roseville', 'Santa Clara', 'Vallejo', 'Victorville'],
            'CO': ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Arvada', 'Westminster', 'Pueblo', 'Centennial', 'Boulder', 'Greeley', 'Longmont', 'Loveland', 'Grand Junction', 'Broomfield', 'Castle Rock', 'Commerce City', 'Parker', 'Littleton', 'Northglenn', 'Brighton', 'Englewood', 'Wheat Ridge', 'Fountain', 'Lafayette', 'Windsor', 'Evans', 'Erie', 'Federal Heights', 'Montrose', 'Golden', 'Louisville', 'Fruita', 'Canon City', 'Sterling', 'Greenwood Village', 'Lone Tree', 'Superior', 'Johnstown', 'Durango', 'Firestone', 'Fort Morgan', 'Frederick', 'Castle Pines', 'Steamboat Springs', 'Glenwood Springs', 'Alamosa', 'Gypsum', 'Delta'],
            'CT': ['Bridgeport', 'New Haven', 'Stamford', 'Hartford', 'Waterbury', 'Norwalk', 'Danbury', 'New Britain', 'Bristol', 'Meriden', 'West Hartford', 'Milford', 'Middletown', 'Norwich', 'Shelton', 'Torrington', 'Naugatuck', 'East Hartford', 'Trumbull', 'Enfield', 'Stratford', 'Greenwich', 'Fairfield', 'Wallingford', 'Manchester', 'Hamden', 'Westport', 'Southington', 'West Haven', 'Groton', 'Newington', 'Cheshire', 'Vernon', 'Wethersfield', 'New London', 'Branford', 'Newtown', 'Glastonbury', 'Ridgefield', 'Windsor', 'New Milford', 'North Haven', 'South Windsor', 'Farmington', 'East Haven', 'Simsbury', 'Windham', 'Guilford', 'Darien', 'Bloomfield'],
            'DE': ['Wilmington', 'Dover', 'Newark', 'Middletown', 'Smyrna', 'Milford', 'Seaford', 'Georgetown', 'Elsmere', 'New Castle', 'Millsboro', 'Laurel', 'Harrington', 'Camden', 'Clayton', 'Lewes', 'Milton', 'Selbyville', 'Bridgeville', 'Townsend', 'Ocean View', 'Delmar', 'Newport', 'Cheswold', 'Wyoming', 'Rehoboth Beach', 'Bellefonte', 'Felton', 'Blades', 'Greenwood', 'Frederica', 'Arden', 'Houston', 'Odessa', 'Dewey Beach', 'Dagsboro', 'Bethany Beach', 'Bethel', 'Ardencroft', 'Ardentown', 'Bowers', 'Farmington', 'Frankford', 'Henlopen Acres', 'Kenton', 'Leipsic', 'Little Creek', 'Magnolia', 'Slaughter Beach', 'Woodside'],
            'FL': ['Jacksonville', 'Miami', 'Tampa', 'Orlando', 'St. Petersburg', 'Hialeah', 'Tallahassee', 'Fort Lauderdale', 'Port St. Lucie', 'Cape Coral', 'Pembroke Pines', 'Hollywood', 'Miramar', 'Gainesville', 'Coral Springs', 'Miami Gardens', 'Clearwater', 'Palm Bay', 'Pompano Beach', 'West Palm Beach', 'Lakeland', 'Davie', 'Miami Beach', 'Sunrise', 'Plantation', 'Boca Raton', 'Deltona', 'Largo', 'Palm Coast', 'Melbourne', 'Deerfield Beach', 'Boynton Beach', 'Lauderhill', 'Weston', 'Fort Myers', 'Kissimmee', 'Homestead', 'Tamarac', 'Delray Beach', 'Daytona Beach', 'North Miami', 'Wellington', 'North Port', 'Jupiter', 'Ocala', 'Port Orange', 'Margate', 'Coconut Creek', 'Sanford', 'Sarasota'],
            'GA': ['Atlanta', 'Augusta', 'Columbus', 'Macon', 'Savannah', 'Athens', 'Sandy Springs', 'Roswell', 'Johns Creek', 'Albany', 'Warner Robins', 'Alpharetta', 'Marietta', 'Valdosta', 'Smyrna', 'Dunwoody', 'Rome', 'East Point', 'Milton', 'Gainesville', 'Stonecrest', 'Peachtree Corners', 'Newnan', 'Douglasville', 'Kennesaw', 'Lawrenceville', 'Statesboro', 'Tucker', 'Duluth', 'Stockbridge', 'Woodstock', 'Carrollton', 'Canton', 'Griffin', 'McDonough', 'Hinesville', 'Redan', 'Dalton', 'Rossville', 'Thomasville', 'Cartersville', 'Union City', 'Decatur', 'Peachtree City', 'Sugar Hill', 'North Druid Hills', 'Riverdale', 'St. Marys', 'Tifton', 'Forest Park'],
            'HI': ['Honolulu', 'East Honolulu', 'Pearl City', 'Hilo', 'Kailua', 'Waipahu', 'Kaneohe', 'Mililani Town', 'Kahului', 'Kihei', 'Mililani Mauka', 'Kailua-Kona', 'Makakilo', 'Wahiawa', 'Wailuku', 'Kapolei', 'Ewa Beach', 'Royal Kunia', 'Halawa', 'Waimalu', 'Ewa Gentry', 'Aiea', 'Nanakuli', 'Waikele', 'Lahaina', 'Kapaa', 'Ocean Pointe', 'Kaneohe Station', 'Hawaiian Paradise Park', 'Schofield Barracks', 'Lihue', 'Kula', 'Holualoa', 'Maili', 'Makaha', 'Kalaeloa', 'Kealakekua', 'Makawao', 'Laie', 'Hanamaulu', 'Waianae', 'Ainaloa', 'Haiku-Pauwela', 'Ewa Villages', 'Pukalani', 'Hawaiian Ocean View', 'Waimea', 'Kahaluu-Keauhou', 'Kalaheo', 'Napili-Honokowai'],
            'ID': ['Boise', 'Meridian', 'Nampa', 'Idaho Falls', 'Pocatello', 'Caldwell', 'Coeur d\'Alene', 'Twin Falls', 'Post Falls', 'Lewiston', 'Rexburg', 'Eagle', 'Moscow', 'Mountain Home', 'Kuna', 'Ammon', 'Chubbuck', 'Hayden', 'Garden City', 'Jerome', 'Burley', 'Blackfoot', 'Hailey', 'Sandpoint', 'Payette', 'Star', 'Rupert', 'Emmett', 'Weiser', 'Preston', 'Fruitland', 'Rathdrum', 'Middleton', 'Shelley', 'Buhl', 'Gooding', 'Orofino', 'American Falls', 'Kimberly', 'St. Anthony', 'Grangeville', 'Rigby', 'Salmon', 'Homedale', 'Kellogg', 'McCall', 'Soda Springs', 'Malad City', 'Wendell', 'Bonners Ferry'],
            'IL': ['Chicago', 'Aurora', 'Joliet', 'Naperville', 'Rockford', 'Springfield', 'Elgin', 'Peoria', 'Champaign', 'Waukegan', 'Cicero', 'Bloomington', 'Evanston', 'Decatur', 'Arlington Heights', 'Schaumburg', 'Bolingbrook', 'Palatine', 'Skokie', 'Des Plaines', 'Orland Park', 'Tinley Park', 'Oak Lawn', 'Berwyn', 'Mount Prospect', 'Normal', 'Wheaton', 'Hoffman Estates', 'Oak Park', 'Downers Grove', 'Gurnee', 'Lombard', 'Buffalo Grove', 'Crystal Lake', 'Carol Stream', 'Romeoville', 'Wheeling', 'Streamwood', 'Addison', 'Carpentersville', 'Bartlett', 'Hanover Park', 'Moline', 'Urbana', 'Quincy', 'Plainfield', 'Park Ridge', 'Calumet City', 'Northbrook', 'Elmhurst'],
            'IN': ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Fishers', 'Bloomington', 'Hammond', 'Gary', 'Lafayette', 'Muncie', 'Terre Haute', 'Kokomo', 'Anderson', 'Noblesville', 'Greenwood', 'Elkhart', 'Mishawaka', 'Lawrence', 'Jeffersonville', 'Columbus', 'Portage', 'New Albany', 'Richmond', 'Valparaiso', 'Michigan City', 'West Lafayette', 'Goshen', 'Marion', 'East Chicago', 'Granger', 'Westfield', 'Crown Point', 'Hobart', 'Merrillville', 'Schererville', 'Plainfield', 'Brownsburg', 'Seymour', 'Shelbyville', 'Logansport', 'Vincennes', 'Highland', 'Franklin', 'Griffith', 'La Porte', 'Munster', 'Clarksville', 'Beech Grove', 'Zionsville'],
            'IA': ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City', 'Iowa City', 'Waterloo', 'Council Bluffs', 'Ames', 'West Des Moines', 'Ankeny', 'Urbandale', 'Cedar Falls', 'Marion', 'Bettendorf', 'Marshalltown', 'Mason City', 'Clinton', 'Burlington', 'Fort Dodge', 'Ottumwa', 'Muscatine', 'Dubuque', 'Coralville', 'Johnston', 'Waukee', 'Clive', 'Boone', 'Newton', 'Indianola', 'Altoona', 'Keokuk', 'North Liberty', 'Oskaloosa', 'Spencer', 'Storm Lake', 'Carroll', 'Fairfield', 'Perry', 'Grinnell', 'Waverly', 'Le Mars', 'Pella', 'Denison', 'Knoxville', 'Washington', 'Mount Pleasant', 'Charles City', 'Decorah', 'Atlantic', 'Webster City'],
            'KS': ['Wichita', 'Overland Park', 'Kansas City', 'Olathe', 'Topeka', 'Lawrence', 'Shawnee', 'Manhattan', 'Lenexa', 'Salina', 'Hutchinson', 'Leavenworth', 'Leawood', 'Dodge City', 'Garden City', 'Junction City', 'Emporia', 'Derby', 'Prairie Village', 'Liberal', 'Hays', 'Pittsburg', 'Gardner', 'Great Bend', 'McPherson', 'Newton', 'El Dorado', 'Ottawa', 'Winfield', 'Arkansas City', 'Andover', 'Lansing', 'Merriam', 'Atchison', 'Haysville', 'Parsons', 'Coffeyville', 'Mission', 'Independence', 'Augusta', 'Wellington', 'Chanute', 'Fort Scott', 'Park City', 'Bonner Springs', 'Roeland Park', 'Valley Center', 'Pratt', 'Bel Aire'],
            'KY': ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington', 'Richmond', 'Georgetown', 'Florence', 'Hopkinsville', 'Nicholasville', 'Elizabethtown', 'Henderson', 'Jeffersontown', 'Frankfort', 'Paducah', 'Independence', 'Radcliff', 'Ashland', 'Madisonville', 'Winchester', 'Erlanger', 'Murray', 'St. Matthews', 'Fort Thomas', 'Danville', 'Newport', 'Shively', 'Shelbyville', 'Glasgow', 'Berea', 'Bardstown', 'Shepherdsville', 'Somerset', 'Lyndon', 'Lawrenceburg', 'Middlesboro', 'Mayfield', 'Mount Sterling', 'Campbellsville', 'Maysville', 'Edgewood', 'Russellville', 'Fort Mitchell', 'Paris', 'Harrodsburg', 'Bellevue', 'Elsmere', 'Franklin', 'Versailles', 'Alexandria'],
            'LA': ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette', 'Lake Charles', 'Kenner', 'Bossier City', 'Monroe', 'Alexandria', 'Houma', 'Marrero', 'New Iberia', 'Laplace', 'Slidell', 'Prairieville', 'Central', 'Hammond', 'Bayou Cane', 'Sulphur', 'Shenandoah', 'Natchitoches', 'Gretna', 'Opelousas', 'Zachary', 'Ruston', 'Pineville', 'Estelle', 'Mandeville', 'Thibodaux', 'Chalmette', 'Minden', 'Youngsville', 'Bogalusa', 'River Ridge', 'Baker', 'Morgan City', 'Abbeville', 'Luling', 'Crowley', 'Moss Bluff', 'Timberlane', 'Woodmere', 'Raceland', 'West Monroe', 'Harvey', 'Eunice', 'Covington', 'DeRidder', 'Gonzales', 'Jennings'],
            'ME': ['Portland', 'Lewiston', 'Bangor', 'South Portland', 'Auburn', 'Biddeford', 'Sanford', 'Saco', 'Augusta', 'Westbrook', 'Waterville', 'Presque Isle', 'Brewer', 'Bath', 'Caribou', 'Old Town', 'Rockland', 'Orono', 'Yarmouth', 'Skowhegan', 'Gorham', 'Kittery', 'Houlton', 'Belfast', 'Falmouth', 'Farmington', 'Cape Elizabeth', 'Scarborough', 'Gardiner', 'Ellsworth', 'Brunswick', 'Winslow', 'Topsham', 'Windham', 'York', 'Lisbon', 'Kennebunk', 'Standish', 'Rumford', 'Millinocket', 'Fairfield', 'Bar Harbor', 'Buxton', 'Camden', 'Wells', 'Hampden', 'Farmingdale', 'Berwick', 'Madawaska', 'Norway'],
            'MD': ['Baltimore', 'Frederick', 'Rockville', 'Gaithersburg', 'Bowie', 'Hagerstown', 'Annapolis', 'College Park', 'Salisbury', 'Laurel', 'Greenbelt', 'Cumberland', 'Westminster', 'Hyattsville', 'Takoma Park', 'Easton', 'Aberdeen', 'Havre de Grace', 'Cambridge', 'New Carrollton', 'Bel Air', 'District Heights', 'Frostburg', 'Mount Rainier', 'Riverdale Park', 'Bladensburg', 'Mount Airy', 'Brunswick', 'Chestertown', 'Walkersville', 'Hampstead', 'Ocean City', 'Cheverly', 'Taneytown', 'Thurmont', 'Glenarden', 'Poolesville', 'Fruitland', 'Manchester', 'Pocomoke City', 'La Plata', 'Westernport', 'Seat Pleasant', 'Denton', 'North East', 'Delmar', 'Emmitsburg', 'Hancock', 'Centreville', 'Snow Hill'],
            'MA': ['Boston', 'Worcester', 'Springfield', 'Lowell', 'Cambridge', 'New Bedford', 'Brockton', 'Quincy', 'Lynn', 'Fall River', 'Newton', 'Lawrence', 'Somerville', 'Framingham', 'Haverhill', 'Waltham', 'Malden', 'Brookline', 'Plymouth', 'Medford', 'Taunton', 'Chicopee', 'Weymouth', 'Revere', 'Peabody', 'Methuen', 'Barnstable', 'Pittsfield', 'Attleboro', 'Everett', 'Salem', 'Westfield', 'Leominster', 'Fitchburg', 'Billerica', 'Holyoke', 'Beverly', 'Marlborough', 'Woburn', 'Amherst', 'Braintree', 'Chelmsford', 'Natick', 'Shrewsbury', 'Randolph', 'Franklin', 'Gloucester', 'Watertown', 'Northampton', 'Agawam'],
            'MI': ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Ann Arbor', 'Lansing', 'Flint', 'Dearborn', 'Livonia', 'Westland', 'Troy', 'Farmington Hills', 'Kalamazoo', 'Wyoming', 'Southfield', 'Rochester Hills', 'Taylor', 'St. Clair Shores', 'Pontiac', 'Dearborn Heights', 'Royal Oak', 'Novi', 'Battle Creek', 'Kentwood', 'Saginaw', 'East Lansing', 'Roseville', 'Portage', 'Midland', 'Muskegon', 'Lincoln Park', 'Bay City', 'Jackson', 'Holland', 'Eastpointe', 'Port Huron', 'Shelby Township', 'Madison Heights', 'Oak Park', 'Burton', 'Garden City', 'Mount Pleasant', 'Inkster', 'Allen Park', 'Wyandotte', 'Norton Shores', 'Walker', 'Romulus', 'Southgate', 'Auburn Hills'],
            'MN': ['Minneapolis', 'St. Paul', 'Rochester', 'Bloomington', 'Duluth', 'Brooklyn Park', 'Plymouth', 'Maple Grove', 'Woodbury', 'St. Cloud', 'Eagan', 'Eden Prairie', 'Coon Rapids', 'Burnsville', 'Blaine', 'Lakeville', 'Minnetonka', 'Apple Valley', 'Edina', 'St. Louis Park', 'Moorhead', 'Mankato', 'Maplewood', 'Shakopee', 'Richfield', 'Cottage Grove', 'Roseville', 'Inver Grove Heights', 'Andover', 'Brooklyn Center', 'Savage', 'Oakdale', 'Fridley', 'Winona', 'Shoreview', 'Ramsey', 'Owatonna', 'Chaska', 'Prior Lake', 'White Bear Lake', 'Chanhassen', 'Champlin', 'Faribault', 'Rosemount', 'Crystal', 'Lino Lakes', 'New Brighton', 'Golden Valley', 'Elk River', 'Farmington'],
            'MS': ['Jackson', 'Gulfport', 'Southaven', 'Hattiesburg', 'Biloxi', 'Meridian', 'Tupelo', 'Olive Branch', 'Greenville', 'Horn Lake', 'Pearl', 'Madison', 'Starkville', 'Clinton', 'Ridgeland', 'Brandon', 'Columbus', 'Vicksburg', 'Oxford', 'Pascagoula', 'Laurel', 'Ocean Springs', 'Natchez', 'Long Beach', 'Greenwood', 'Corinth', 'Hernando', 'Gautier', 'Canton', 'Grenada', 'Cleveland', 'Moss Point', 'McComb', 'Brookhaven', 'Clarksdale', 'Flowood', 'D\'Iberville', 'West Point', 'Indianola', 'Yazoo City', 'Picayune', 'Petal', 'Byram', 'Bay St. Louis', 'Kosciusko', 'Waveland', 'Booneville', 'New Albany', 'Holly Springs', 'Amory'],
            'MO': ['Kansas City', 'St. Louis', 'Springfield', 'Columbia', 'Independence', 'Lee\'s Summit', 'O\'Fallon', 'St. Joseph', 'St. Charles', 'St. Peters', 'Blue Springs', 'Florissant', 'Joplin', 'Chesterfield', 'Jefferson City', 'Cape Girardeau', 'Wentzville', 'University City', 'Liberty', 'Ballwin', 'Raytown', 'Kirkwood', 'Maryland Heights', 'Gladstone', 'Hazelwood', 'Webster Groves', 'Grandview', 'Belton', 'Sedalia', 'Ferguson', 'Arnold', 'Rolla', 'Nixa', 'Sikeston', 'Raymore', 'Wildwood', 'Washington', 'Ozark', 'Manchester', 'Poplar Bluff', 'Republic', 'Warrensburg', 'Hannibal', 'Mexico', 'Carthage', 'Moberly', 'Clayton', 'Lebanon', 'West Plains', 'Kennett'],
            'MT': ['Billings', 'Missoula', 'Great Falls', 'Bozeman', 'Butte', 'Helena', 'Kalispell', 'Havre', 'Anaconda', 'Miles City', 'Belgrade', 'Livingston', 'Laurel', 'Whitefish', 'Lewistown', 'Glendive', 'Sidney', 'Columbia Falls', 'Polson', 'Hamilton', 'Dillon', 'Shelby', 'Hardin', 'Cut Bank', 'Wolf Point', 'Glasgow', 'Colstrip', 'Red Lodge', 'Deer Lodge', 'Malta', 'East Helena', 'Conrad', 'Townsend', 'Plains', 'Forsyth', 'Ronan', 'Libby', 'Fort Benton', 'Thompson Falls', 'Boulder', 'Chinook', 'Manhattan', 'Roundup', 'Plentywood', 'Three Forks', 'Stevensville', 'Baker', 'Choteau', 'Big Timber', 'Columbus'],
            'NE': ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island', 'Kearney', 'Fremont', 'Hastings', 'Norfolk', 'Columbus', 'North Platte', 'Papillion', 'La Vista', 'Scottsbluff', 'South Sioux City', 'Beatrice', 'Lexington', 'Alliance', 'Gering', 'Blair', 'York', 'McCook', 'Ralston', 'Nebraska City', 'Seward', 'Sidney', 'Gretna', 'Crete', 'Plattsmouth', 'Holdrege', 'Schuyler', 'Ogallala', 'Aurora', 'Falls City', 'Wayne', 'Chadron', 'Fairbury', 'Waverly', 'Wahoo', 'Central City', 'Broken Bow', 'Auburn', 'Valentine', 'West Point', 'Gothenburg', 'Minden', 'David City', 'Imperial', 'Kimball', 'O\'Neill', 'Ashland'],
            'NV': ['Las Vegas', 'Henderson', 'Reno', 'North Las Vegas', 'Sparks', 'Carson City', 'Fernley', 'Elko', 'Mesquite', 'Boulder City', 'Fallon', 'Winnemucca', 'West Wendover', 'Yerington', 'Ely', 'Carlin', 'Lovelock', 'Wells', 'Caliente', 'Enterprise', 'Summerlin South', 'Spring Valley', 'Sunrise Manor', 'Paradise', 'Winchester', 'Whitney', 'Laughlin', 'Moapa Valley', 'Gardnerville Ranchos', 'Spring Creek', 'Dayton', 'Incline Village', 'Pahrump', 'Indian Hills', 'Silver Springs', 'Minden', 'Sun Valley', 'Spanish Springs', 'Gardnerville', 'Cold Springs', 'Jackpot', 'Johnson Lane', 'Washoe Valley', 'Lemmon Valley', 'Genoa', 'Virginia City', 'Cal-Nev-Ari', 'Round Hill Village', 'Searchlight'],
            'NH': ['Manchester', 'Nashua', 'Concord', 'Derry', 'Dover', 'Rochester', 'Salem', 'Merrimack', 'Londonderry', 'Hudson', 'Keene', 'Bedford', 'Portsmouth', 'Goffstown', 'Laconia', 'Hampton', 'Milford', 'Durham', 'Exeter', 'Windham', 'Hooksett', 'Claremont', 'Lebanon', 'Pelham', 'Somersworth', 'Hanover', 'Amherst', 'Raymond', 'Conway', 'Berlin', 'Newmarket', 'Weare', 'Seabrook', 'Barrington', 'Hampstead', 'Franklin', 'Litchfield', 'Hollis', 'Plaistow', 'Bow', 'Stratham', 'Gilford', 'Pembroke', 'Hopkinton', 'Jaffrey', 'Hillsborough', 'Rindge', 'Swanzey', 'Plymouth', 'Newport'],
            'NJ': ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Clifton', 'Trenton', 'Camden', 'Passaic', 'Union City', 'Bayonne', 'East Orange', 'Vineland', 'New Brunswick', 'Hoboken', 'Perth Amboy', 'West New York', 'Plainfield', 'Hackensack', 'Sayreville', 'Kearny', 'Linden', 'Atlantic City', 'Fort Lee', 'Fair Lawn', 'Toms River', 'Jackson', 'Irvington', 'Wayne', 'Parsippany-Troy Hills', 'Howell', 'Brick', 'Bridgewater', 'Cherry Hill', 'Bloomfield', 'Edison', 'North Bergen', 'Old Bridge', 'Gloucester Township', 'Montclair', 'Woodbridge', 'Bayonne', 'Evesham Township', 'Middletown', 'Piscataway', 'Hamilton Township', 'East Brunswick', 'Lakewood Township', 'Egg Harbor Township', 'Manchester Township', 'South Brunswick'],
            'NM': ['Albuquerque', 'Las Cruces', 'Rio Rancho', 'Santa Fe', 'Roswell', 'Farmington', 'Alamogordo', 'Clovis', 'Hobbs', 'Carlsbad', 'Gallup', 'Deming', 'Los Lunas', 'Chaparral', 'Sunland Park', 'Las Vegas', 'Portales', 'Los Alamos', 'Silver City', 'Lovington', 'Artesia', 'Grants', 'Socorro', 'Anthony', 'Española', 'Bernalillo', 'Taos', 'Corrales', 'Truth or Consequences', 'Ruidoso', 'Bloomfield', 'Aztec', 'Belen', 'Los Ranchos de Albuquerque', 'Eldorado at Santa Fe', 'Raton', 'Edgewood', 'Red River', 'Tularosa', 'Zuni Pueblo', 'Ruidoso Downs', 'Bayard', 'Lovington', 'Bosque Farms', 'Questa', 'Jemez Pueblo', 'Santa Clara', 'Milan', 'Columbus', 'Cloudcroft'],
            'NY': ['New York', 'Buffalo', 'Rochester', 'Yonkers', 'Syracuse', 'Albany', 'New Rochelle', 'Mount Vernon', 'Schenectady', 'Utica', 'White Plains', 'Hempstead', 'Troy', 'Niagara Falls', 'Binghamton', 'Freeport', 'Valley Stream', 'Long Beach', 'Rome', 'North Tonawanda', 'Ithaca', 'Jamestown', 'Elmira', 'Poughkeepsie', 'Lindenhurst', 'Port Chester', 'Auburn', 'Spring Valley', 'Newburgh', 'Glen Cove', 'Saratoga Springs', 'Harrison', 'Middletown', 'Rockville Centre', 'Ossining', 'Kingston', 'Watertown', 'Peekskill', 'Plattsburgh', 'Mamaroneck', 'Cortland', 'Lackawanna', 'Amsterdam', 'Oswego', 'Floral Park', 'Garden City', 'Batavia', 'Ogdensburg', 'Geneva', 'Massena'],
            'NC': ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Fayetteville', 'Cary', 'Wilmington', 'High Point', 'Concord', 'Greenville', 'Asheville', 'Gastonia', 'Jacksonville', 'Chapel Hill', 'Rocky Mount', 'Burlington', 'Huntersville', 'Wilson', 'Kannapolis', 'Apex', 'Hickory', 'Goldsboro', 'Indian Trail', 'Mooresville', 'Wake Forest', 'Monroe', 'Sanford', 'Matthews', 'Garner', 'New Bern', 'Statesville', 'Cornelius', 'Mint Hill', 'Thomasville', 'Asheboro', 'Kernersville', 'Salisbury', 'Holly Springs', 'Kinston', 'Lumberton', 'Havelock', 'Shelby', 'Clemmons', 'Morganton', 'Fuquay-Varina', 'Morrisville', 'Roanoke Rapids', 'Lewisville', 'Eden'],
            'ND': ['Fargo', 'Bismarck', 'Grand Forks', 'Minot', 'West Fargo', 'Williston', 'Dickinson', 'Mandan', 'Jamestown', 'Wahpeton', 'Devils Lake', 'Valley City', 'Grafton', 'Beulah', 'Rugby', 'Stanley', 'Horace', 'Lincoln', 'Casselton', 'Carrington', 'Lisbon', 'Watford City', 'Bottineau', 'Mayville', 'Langdon', 'Harvey', 'Oakes', 'New Town', 'Garrison', 'Ellendale', 'Belcourt', 'Cavalier', 'Hillsboro', 'Washburn', 'Bowman', 'Burlington', 'Hazen', 'Beach', 'Velva', 'Thompson', 'Tioga', 'Larimore', 'Hettinger', 'Cooperstown', 'Parshall', 'Cando', 'Rolla', 'Crosby', 'Linton', 'Hankinson'],
            'OH': ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Parma', 'Canton', 'Youngstown', 'Lorain', 'Hamilton', 'Springfield', 'Kettering', 'Elyria', 'Lakewood', 'Cuyahoga Falls', 'Middletown', 'Euclid', 'Newark', 'Mansfield', 'Mentor', 'Beavercreek', 'Cleveland Heights', 'Strongsville', 'Dublin', 'Fairfield', 'Findlay', 'Warren', 'Lancaster', 'Lima', 'Huber Heights', 'Westerville', 'Marion', 'Grove City', 'East Cleveland', 'Reynoldsburg', 'Garfield Heights', 'Stow', 'Delaware', 'Brunswick', 'Upper Arlington', 'North Olmsted', 'Fairborn', 'Massillon', 'Mason', 'North Ridgeville', 'Kent', 'Xenia', 'Bowling Green', 'Sandusky'],
            'OK': ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Lawton', 'Edmond', 'Moore', 'Midwest City', 'Enid', 'Stillwater', 'Muskogee', 'Bartlesville', 'Owasso', 'Shawnee', 'Ponca City', 'Ardmore', 'Duncan', 'Del City', 'Sapulpa', 'Bixby', 'Bethany', 'Altus', 'Yukon', 'McAlester', 'Mustang', 'Chickasha', 'Claremore', 'Ada', 'El Reno', 'Durant', 'Miami', 'Guthrie', 'Woodward', 'Sand Springs', 'Tahlequah', 'Jenks', 'Guymon', 'Okmulgee', 'The Village', 'Warr Acres', 'Coweta', 'Wagoner', 'Blanchard', 'Weatherford', 'Elk City', 'Seminole', 'Cushing', 'Sallisaw', 'Choctaw', 'Pryor Creek'],
            'OR': ['Portland', 'Salem', 'Eugene', 'Gresham', 'Hillsboro', 'Beaverton', 'Bend', 'Medford', 'Springfield', 'Corvallis', 'Albany', 'Tigard', 'Lake Oswego', 'Keizer', 'Grants Pass', 'Oregon City', 'McMinnville', 'Redmond', 'Tualatin', 'West Linn', 'Woodburn', 'Forest Grove', 'Roseburg', 'Newberg', 'Wilsonville', 'Klamath Falls', 'Milwaukie', 'Ashland', 'Sherwood', 'Happy Valley', 'Central Point', 'Hermiston', 'Pendleton', 'Coos Bay', 'Troutdale', 'Canby', 'Dallas', 'Lebanon', 'La Grande', 'St. Helens', 'The Dalles', 'Ontario', 'Sandy', 'Astoria', 'Gladstone', 'Cornelius', 'Independence', 'Newport', 'Molalla', 'Monmouth'],
            'PA': ['Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Reading', 'Scranton', 'Bethlehem', 'Lancaster', 'Harrisburg', 'Altoona', 'York', 'State College', 'Wilkes-Barre', 'Chester', 'Norristown', 'Bethel Park', 'Williamsport', 'Monroeville', 'Plum', 'Easton', 'New Castle', 'Lebanon', 'McKeesport', 'Hazleton', 'Johnstown', 'Pottstown', 'West Mifflin', 'Chambersburg', 'Hermitage', 'Lansdale', 'Greensburg', 'Washington', 'Butler', 'Lower Burrell', 'Hanover', 'Coatesville', 'Phoenixville', 'Baldwin', 'Sharon', 'New Kensington', 'West Chester', 'Murrysville', 'Pottsville', 'Carlisle', 'Wilkinsburg', 'Indiana', 'Mechanicsburg', 'Waynesboro', 'Ephrata', 'Franklin'],
            'RI': ['Providence', 'Warwick', 'Cranston', 'Pawtucket', 'East Providence', 'Woonsocket', 'Coventry', 'Cumberland', 'North Providence', 'South Kingstown', 'West Warwick', 'Johnston', 'North Kingstown', 'Newport', 'Bristol', 'Westerly', 'Smithfield', 'Lincoln', 'Central Falls', 'Portsmouth', 'Barrington', 'Middletown', 'Burrillville', 'Narragansett', 'Tiverton', 'East Greenwich', 'Warren', 'Scituate', 'Glocester', 'Hopkinton', 'Charlestown', 'Richmond', 'Exeter', 'West Greenwich', 'Jamestown', 'Foster', 'Little Compton', 'New Shoreham', 'Valley Falls', 'Greenville', 'Manville', 'Pascoag', 'Hope Valley', 'Wyoming', 'Harrisville', 'Ashaway', 'Bradford', 'Chepachet', 'Carolina', 'Harmony'],
            'SC': ['Columbia', 'Charleston', 'North Charleston', 'Mount Pleasant', 'Rock Hill', 'Greenville', 'Summerville', 'Spartanburg', 'Goose Creek', 'Hilton Head Island', 'Sumter', 'Florence', 'Myrtle Beach', 'Aiken', 'Greer', 'Anderson', 'Mauldin', 'Greenwood', 'North Augusta', 'Easley', 'Simpsonville', 'Hanahan', 'Lexington', 'Conway', 'West Columbia', 'North Myrtle Beach', 'Clemson', 'Orangeburg', 'Cayce', 'Bluffton', 'Georgetown', 'Summerville', 'Irmo', 'Fort Mill', 'Newberry', 'Port Royal', 'Forest Acres', 'Laurens', 'Lancaster', 'Gaffney', 'Union', 'Clinton', 'York', 'Tega Cay', 'Seneca', 'Beaufort', 'Fountain Inn', 'Bennettsville', 'Camden', 'Hartsville'],
            'SD': ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings', 'Watertown', 'Mitchell', 'Yankton', 'Pierre', 'Huron', 'Vermillion', 'Spearfish', 'Brandon', 'Box Elder', 'Madison', 'Sturgis', 'Belle Fourche', 'Harrisburg', 'Tea', 'Hot Springs', 'Dell Rapids', 'Lead', 'Milbank', 'Canton', 'Mobridge', 'Redfield', 'Chamberlain', 'Hartford', 'Winner', 'Custer', 'Springfield', 'Sisseton', 'Lennox', 'Flandreau', 'North Sioux City', 'Whitewood', 'Dakota Dunes', 'Wagner', 'Webster', 'Martin', 'Beresford', 'Platte', 'Gettysburg', 'Britton', 'Elk Point', 'Miller', 'Freeman', 'Parkston', 'Wall', 'Scotland', 'Hill City'],
            'TN': ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Franklin', 'Jackson', 'Johnson City', 'Bartlett', 'Hendersonville', 'Kingsport', 'Collierville', 'Cleveland', 'Smyrna', 'Germantown', 'Brentwood', 'Spring Hill', 'Columbia', 'La Vergne', 'Gallatin', 'Cookeville', 'Oak Ridge', 'Lebanon', 'Mount Juliet', 'Morristown', 'Bristol', 'Farragut', 'Shelbyville', 'Maryville', 'Greeneville', 'Tullahoma', 'Sevierville', 'Springfield', 'Dickson', 'Athens', 'Dyersburg', 'Goodlettsville', 'Paris', 'Crossville', 'McMinnville', 'Elizabethton', 'Portland', 'Millington', 'Manchester', 'White House', 'Martin', 'Alcoa', 'Lewisburg', 'Lawrenceburg'],
            'TX': ['Houston', 'San Antonio', 'Dallas', 'Austin', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Laredo', 'Lubbock', 'Irving', 'Garland', 'Frisco', 'McKinney', 'Amarillo', 'Grand Prairie', 'Brownsville', 'Killeen', 'Pasadena', 'Midland', 'McAllen', 'Denton', 'Mesquite', 'Waco', 'Carrollton', 'Round Rock', 'Richardson', 'Pearland', 'College Station', 'Wichita Falls', 'Lewisville', 'Tyler', 'Odessa', 'Allen', 'Beaumont', 'Sugar Land', 'League City', 'Edinburg', 'Mission', 'Longview', 'Conroe', 'Bryan', 'Baytown', 'Pharr', 'Temple', 'Flower Mound', 'Abilene', 'New Braunfels', 'Harlingen'],
            'UT': ['Salt Lake City', 'West Valley City', 'Provo', 'West Jordan', 'Orem', 'Sandy', 'Ogden', 'St. George', 'Layton', 'South Jordan', 'Lehi', 'Millcreek', 'Taylorsville', 'Logan', 'Murray', 'Draper', 'Bountiful', 'Riverton', 'Roy', 'Spanish Fork', 'Pleasant Grove', 'Cottonwood Heights', 'Springville', 'Cedar City', 'Tooele', 'Kaysville', 'Herriman', 'Clearfield', 'Holladay', 'American Fork', 'Syracuse', 'Saratoga Springs', 'Eagle Mountain', 'Washington', 'Clinton', 'South Salt Lake', 'Farmington', 'North Ogden', 'Payson', 'North Salt Lake', 'Brigham City', 'Highland', 'Centerville', 'Hurricane', 'South Ogden', 'Woods Cross', 'Midvale', 'Smithfield', 'Lindon', 'North Logan'],
            'VT': ['Burlington', 'Rutland', 'Essex Junction', 'South Burlington', 'Bennington', 'Barre', 'Montpelier', 'Winooski', 'St. Albans', 'Newport', 'Vergennes', 'Brattleboro', 'Milton', 'Hartford', 'Springfield', 'Colchester', 'Williston', 'Middlebury', 'Essex', 'St. Johnsbury', 'Bellows Falls', 'Swanton', 'Lyndon', 'Northfield', 'Randolph', 'Waterbury', 'Morrisville', 'Shelburne', 'Brandon', 'Hinesburg', 'Hyde Park', 'Bristol', 'Fairfax', 'Poultney', 'Johnson', 'Hardwick', 'Woodstock', 'Georgia', 'Manchester', 'Chester', 'Richmond', 'Fair Haven', 'Jericho', 'Derby', 'Cambridge', 'Enosburg Falls', 'Orleans', 'Castleton', 'Wells River', 'Stowe'],
            'VA': ['Virginia Beach', 'Norfolk', 'Chesapeake', 'Richmond', 'Newport News', 'Alexandria', 'Hampton', 'Roanoke', 'Portsmouth', 'Suffolk', 'Lynchburg', 'Harrisonburg', 'Leesburg', 'Charlottesville', 'Danville', 'Blacksburg', 'Manassas', 'Petersburg', 'Winchester', 'Salem', 'Fredericksburg', 'Roanoke County', 'Staunton', 'Fairfax', 'Hopewell', 'Christiansburg', 'Herndon', 'Waynesboro', 'Vienna', 'Colonial Heights', 'Radford', 'Falls Church', 'Williamsburg', 'Manassas Park', 'Bristol', 'Purcellville', 'Culpeper', 'Front Royal', 'Martinsville', 'Vinton', 'Warrenton', 'Ashburn', 'South Boston', 'Farmville', 'Wytheville', 'Abingdon', 'Bedford', 'Smithfield', 'Galax', 'Bridgewater'],
            'WA': ['Seattle', 'Spokane', 'Tacoma', 'Vancouver', 'Bellevue', 'Kent', 'Everett', 'Renton', 'Yakima', 'Federal Way', 'Spokane Valley', 'Bellingham', 'Kennewick', 'Auburn', 'Pasco', 'Marysville', 'Lakewood', 'Redmond', 'Shoreline', 'Richland', 'Kirkland', 'Burien', 'Sammamish', 'Olympia', 'Lacey', 'Lynnwood', 'Bothell', 'Wenatchee', 'Mount Vernon', 'Issaquah', 'Walla Walla', 'University Place', 'Pullman', 'Des Moines', 'Lake Stevens', 'SeaTac', 'Maple Valley', 'Bainbridge Island', 'Oak Harbor', 'Kenmore', 'Moses Lake', 'Edmonds', 'Camas', 'Mukilteo', 'Puyallup', 'Battle Ground', 'Sunnyside', 'Bonney Lake', 'Ellensburg', 'Mercer Island'],
            'WV': ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg', 'Wheeling', 'Weirton', 'Fairmont', 'Martinsburg', 'Beckley', 'Clarksburg', 'South Charleston', 'St. Albans', 'Vienna', 'Bluefield', 'Moundsville', 'Bridgeport', 'Dunbar', 'Elkins', 'Nitro', 'Hurricane', 'Princeton', 'Buckhannon', 'Logan', 'Charles Town', 'Oak Hill', 'Point Pleasant', 'Ravenswood', 'Grafton', 'Keyser', 'Lewisburg', 'Summersville', 'New Martinsville', 'Kingwood', 'Westover', 'Williamson', 'Ranson', 'Weston', 'Wellsburg', 'Belle', 'Philippi', 'Montgomery', 'Ripley', 'Spencer', 'Richwood', 'White Sulphur Springs', 'Ronceverte', 'Hinton', 'Kenova', 'Sistersville', 'Romney'],
            'WI': ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Oshkosh', 'Eau Claire', 'West Allis', 'Janesville', 'La Crosse', 'Sheboygan', 'Wauwatosa', 'Fond du Lac', 'New Berlin', 'Wausau', 'Brookfield', 'Beloit', 'Greenfield', 'Franklin', 'Oak Creek', 'Manitowoc', 'West Bend', 'Sun Prairie', 'Superior', 'Stevens Point', 'Neenah', 'Fitchburg', 'Muskego', 'South Milwaukee', 'Watertown', 'De Pere', 'Menasha', 'Kaukauna', 'Marshfield', 'Cudahy', 'Wisconsin Rapids', 'Onalaska', 'Middleton', 'Beaver Dam', 'Whitewater', 'Chippewa Falls', 'Menomonie', 'Mequon', 'River Falls', 'Platteville', 'Two Rivers', 'Antigo', 'Fort Atkinson'],
            'WY': ['Cheyenne', 'Casper', 'Laramie', 'Gillette', 'Rock Springs', 'Sheridan', 'Green River', 'Evanston', 'Riverton', 'Cody', 'Jackson', 'Rawlins', 'Lander', 'Powell', 'Douglas', 'Torrington', 'Worland', 'Buffalo', 'Mills', 'Wheatland', 'Newcastle', 'Bar Nunn', 'Thermopolis', 'Kemmerer', 'Glenrock', 'Lovell', 'Lyman', 'Greybull', 'Afton', 'Saratoga', 'Ranchester', 'Pine Bluffs', 'Pinedale', 'Mountain View', 'Guernsey', 'Lingle', 'Sundance', 'Moorcroft', 'Evansville', 'Basin', 'Dubois', 'Upton', 'Diamondville', 'Wright', 'Ten Sleep', 'Hulett', 'Dayton', 'Deaver', 'Frannie', 'Dixon']
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