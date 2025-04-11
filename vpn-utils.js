/**
 * VPN Utilities for NordVPN
 * Handles IP rotation and connection status checking
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');

// Import logger or use console as fallback
let logger;
try {
  logger = require('./logger');
} catch (e) {
  logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
  };
}

// Store available VPN servers for smarter rotation
const serverCache = {
  countryCodes: [
    'us', 'ca', 'uk', 'de', 'fr', 'nl', 'se', 'no', 'ch', 'au'
  ],
  lastUsedCountry: null,
  currentServer: null,
  lastRotation: 0,
  rotationCooldown: 30000, // 30 seconds minimum between rotations
  simulationCooldown: 5000, // Much shorter cooldown for simulation mode (5 seconds)
  statusCache: null,
  statusTimestamp: 0,
  blockDetectionCount: 0,
  isCliAvailable: null, // Will be set during initialization
  vpnType: null, // Will detect which VPN system is available
  nordvpnPath: 'C:\\Program Files\\NordVPN',
  cities: {
    "Americas": {
      "EE. UU.": [
        "New York", "Los Angeles", "Chicago", "Dallas", "Miami", 
        "Seattle", "Atlanta", "Denver", "Phoenix", "Boston",
        "San Francisco", "Las Vegas", "Washington DC", "Houston", "Philadelphia"
      ],
      "Canada": ["Toronto", "Montreal", "Vancouver"]
    },
    "Europe": {
      "UK": ["London", "Manchester"],
      "Germany": ["Berlin", "Frankfurt"],
      "France": ["Paris"],
      "Netherlands": ["Amsterdam"],
      "Spain": ["Madrid", "Barcelona"]
    }
  },
  preferredCountry: "EE. UU.",
  preferredRegion: "Americas",
};

const vpnUtils = {
  /**
   * Check if NordVPN CLI is available on the system
   * @returns {Promise<boolean>} Whether NordVPN CLI is available
   */
  async checkVpnCliAvailable() {
    // Return cached result if already checked
    if (serverCache.isCliAvailable !== null) {
      return serverCache.isCliAvailable;
    }
    
    try {
      // Try to get NordVPN version - will fail if not installed
      await execAsync('nordvpn --version');
      serverCache.isCliAvailable = true;
      serverCache.vpnType = 'nordvpn';
      logger.info('NordVPN CLI is available');
      return true;
    } catch (error) {
      // Check for OpenVPN as a fallback
      try {
        await execAsync('openvpn --version');
        serverCache.isCliAvailable = true;
        serverCache.vpnType = 'openvpn';
        logger.info('OpenVPN CLI is available as a fallback');
        return true;
      } catch (e) {
        // Both are unavailable
        serverCache.isCliAvailable = false;
        serverCache.vpnType = null;
        logger.warn('No VPN CLI available on this system. IP rotation will be simulated.');
        return false;
      }
    }
  },

  /**
   * Check if NordVPN is currently connected
   * @returns {Promise<boolean>} Connection status
   */
  async isConnected() {
    // Ensure CLI is available before checking
    if (await this.checkVpnCliAvailable() === false) {
      return this.simulateVpnStatus();
    }

    try {
      // Use cached status if recent
      if (serverCache.statusCache !== null && 
          Date.now() - serverCache.statusTimestamp < 10000) {
        return serverCache.statusCache;
      }
      
      const { stdout } = await execAsync('nordvpn status');
      const isConnected = stdout.includes('Connected');
      
      // Cache the result
      serverCache.statusCache = isConnected;
      serverCache.statusTimestamp = Date.now();
      
      if (isConnected) {
        // Extract current server info
        const match = stdout.match(/Current server: ([^\r\n]+)/);
        if (match) {
          serverCache.currentServer = match[1];
        }
      }
      
      return isConnected;
    } catch (error) {
      logger.error(`Error checking VPN connection: ${error.message}`);
      return this.simulateVpnStatus();
    }
  },
  
  /**
   * Connect to NordVPN
   * @param {string} [country=null] Optional country code
   * @returns {Promise<boolean>} Connection success
   */
  async connect(country = null) {
    // Ensure CLI is available before connecting
    if (await this.checkVpnCliAvailable() === false) {
      return this.simulateVpnConnect(country);
    }

    try {
      let command = 'nordvpn connect';
      
      if (country) {
        command += ` ${country}`;
      }
      
      logger.info(`Connecting to NordVPN${country ? ' (' + country + ')' : ''}`);
      
      const { stdout, stderr } = await execAsync(command);
      
      if (stdout.includes('Connected') || stdout.includes('You are connected')) {
        logger.info(`Successfully connected to NordVPN`);
        
        // Update cache
        if (country) {
          serverCache.lastUsedCountry = country;
        }
        
        // Clear status cache to force refresh
        serverCache.statusCache = null;
        
        return true;
      } else {
        logger.warn(`Failed to connect to NordVPN: ${stdout}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error connecting to NordVPN: ${error.message}`);
      return this.simulateVpnConnect(country);
    }
  },
  
  /**
   * Disconnect from NordVPN
   * @returns {Promise<boolean>} Disconnection success
   */
  async disconnect() {
    // Ensure CLI is available before disconnecting
    if (await this.checkVpnCliAvailable() === false) {
      return this.simulateVpnDisconnect();
    }

    try {
      logger.info('Disconnecting from NordVPN');
      
      const { stdout } = await execAsync('nordvpn disconnect');
      
      if (stdout.includes('disconnected') || stdout.includes('not connected')) {
        logger.info('Successfully disconnected from NordVPN');
        
        // Clear status cache
        serverCache.statusCache = null;
        
        return true;
      } else {
        logger.warn(`Unexpected response when disconnecting: ${stdout}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error disconnecting from NordVPN: ${error.message}`);
      return this.simulateVpnDisconnect();
    }
  },
  
  /**
   * Rotate VPN IP by disconnecting and connecting to a different server
   * @param {boolean} forceRotation Force rotation even if on cooldown
   * @returns {Promise<boolean>} Rotation success
   */
  async rotateIP(forceRotation = false) {
    // Check rotation cooldown - use shorter cooldown for simulation mode
    const now = Date.now();
    const isSimulated = await this.checkVpnCliAvailable() === false;
    const cooldownPeriod = isSimulated ? serverCache.simulationCooldown : serverCache.rotationCooldown;
    
    if (!forceRotation && (now - serverCache.lastRotation < cooldownPeriod)) {
      logger.info(`VPN rotation on cooldown. Waited only ${Math.round((now - serverCache.lastRotation) / 1000)}s since last rotation (${cooldownPeriod/1000}s needed).`);
      
      // For simulation mode with high block detection count, bypass cooldown
      if (isSimulated && serverCache.blockDetectionCount > 5) {
        logger.info('High block detection count, bypassing cooldown in simulation mode');
        forceRotation = true;
      } else {
        return false;
      }
    }

    // If CLI isn't available, simulate IP rotation
    if (isSimulated) {
      return this.simulateIpRotation(forceRotation);
    }
    
    try {
      logger.info('Rotating Nord VPN IP address...');
      
      // First disconnect
      await this.disconnect();
      
      // Wait a moment before reconnecting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Select a country different from the last one used
      let country = null;
      if (serverCache.countryCodes.length > 1) {
        const availableCountries = serverCache.countryCodes.filter(
          c => c !== serverCache.lastUsedCountry
        );
        
        if (availableCountries.length > 0) {
          country = availableCountries[Math.floor(Math.random() * availableCountries.length)];
        }
      }
      
      // Connect to a new server
      const connected = await this.connect(country);
      
      if (connected) {
        // Update last rotation time
        serverCache.lastRotation = Date.now();
        
        // Wait for connection to stabilize
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Verify connection
        const isConnected = await this.isConnected();
        
        if (isConnected) {
          logger.info(`Successfully rotated VPN IP address to ${serverCache.currentServer || 'new server'}`);
          
          // Reset block detection counter
          serverCache.blockDetectionCount = 0;
          
          return true;
        } else {
          logger.error('Failed to verify VPN connection after rotation');
          return false;
        }
      } else {
        // Try connecting without specific country
        logger.warn('Failed to connect to specified country, trying automatic server selection');
        
        const retryConnected = await this.connect();
        if (retryConnected) {
          serverCache.lastRotation = Date.now();
          logger.info('Successfully rotated VPN IP using automatic server selection');
          serverCache.blockDetectionCount = 0;
          return true;
        }
        
        return false;
      }
    } catch (error) {
      logger.error(`Error rotating VPN IP: ${error.message}`);
      return this.simulateIpRotation();
    }
  },
  
  /**
   * Get current IP information
   * @returns {Promise<Object>} IP information
   */
  async getIPInfo() {
    try {
      const { stdout } = await execAsync('curl -s https://ipinfo.io/json');
      return JSON.parse(stdout);
    } catch (error) {
      // Try alternative IP info service if curl fails
      try {
        const { stdout } = await execAsync('curl -s https://api.ipify.org?format=json');
        const ip = JSON.parse(stdout).ip;
        return {
          ip,
          hostname: 'unknown',
          city: 'unknown',
          region: 'unknown',
          country: 'unknown',
          loc: '0,0',
          org: 'unknown'
        };
      } catch (e) {
        logger.error(`Error getting IP info: ${e.message}`);
        return null;
      }
    }
  },
  
  /**
   * Check if request was blocked (to determine if IP rotation is needed)
   * @param {number} statusCode HTTP status code
   * @param {string} html Response HTML
   * @returns {boolean} True if blocked
   */
  isBlocked(statusCode, html) {
    // Check status code first - more reliable indicators
    if (statusCode === 403 || statusCode === 429 || statusCode === 503) {
      serverCache.blockDetectionCount += 2; // Higher weight for status codes
      return true;
    }
    
    // Check content for CAPTCHA and block indicators
    if (html && typeof html === 'string') {
      const lowerHtml = html.toLowerCase();
      
      // Separate definite block indicators from possible ones
      const definitiveBlockIndicators = [
        'captcha', 'security check', 'unusual traffic', 'automated', 
        'too many requests', 'rate limit', 'denied'
      ];
      
      const possibleBlockIndicators = [
        'robot', 'suspicious', 'temporary block', 
        'access denied', 'forbidden', 'cloudflare',
        'ddos protection', 'human verification'
      ];
      
      // Check for definitive indicators first
      for (const indicator of definitiveBlockIndicators) {
        if (lowerHtml.includes(indicator)) {
          serverCache.blockDetectionCount += 2; // Higher weight
          return true;
        }
      }
      
      // Then check for possible indicators that might be false positives
      for (const indicator of possibleBlockIndicators) {
        if (lowerHtml.includes(indicator)) {
          // Increase detection count but require more confirmations
          serverCache.blockDetectionCount += 1;
          // Only return true if we've seen multiple indicators
          return serverCache.blockDetectionCount >= 3;
        }
      }
    }
    
    return false;
  },
  
  /**
   * Check if we should rotate IP based on detection count
   * @returns {boolean} True if IP rotation is recommended
   */
  shouldRotateIP() {
    return serverCache.blockDetectionCount >= 3;
  },
  
  /**
   * Register a block detection event
   * @returns {number} Current block detection count
   */
  registerBlockDetection() {
    return ++serverCache.blockDetectionCount;
  },
  
  /**
   * Reset block detection counter
   */
  resetBlockCounter() {
    serverCache.blockDetectionCount = 0;
    return 0;
  },
  
  /**
   * Initialize VPN settings from config file if available
   * @returns {Promise<boolean>} Initialization status
   */
  async initialize() {
    try {
      // Try to load configuration
      const configPath = path.join(__dirname, 'vpn-config.json');
      
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        if (config.countryCodes && Array.isArray(config.countryCodes)) {
          serverCache.countryCodes = config.countryCodes;
        }
        
        if (config.rotationCooldown && typeof config.rotationCooldown === 'number') {
          serverCache.rotationCooldown = config.rotationCooldown;
        }
        
        logger.info('VPN configuration loaded successfully');
      }
      
      // Check if VPN CLI is available
      await this.checkVpnCliAvailable();
      
      // Check if VPN is connected on startup only if CLI is available
      if (serverCache.isCliAvailable) {
        const connected = await this.isConnected();
        
        if (connected) {
          logger.info(`VPN is connected to ${serverCache.currentServer || 'server'}`);
          return true;
        } else {
          logger.warn('VPN is not connected, automatic rotation may not work');
          return false;
        }
      } else {
        logger.warn('VPN CLI not available - will simulate VPN operations');
        return true;
      }
    } catch (error) {
      logger.error(`Error initializing VPN utilities: ${error.message}`);
      return false;
    }
  },
  
  /**
   * Simulate VPN connection status when CLI is not available
   * @returns {boolean} Simulated connection status
   */
  simulateVpnStatus() {
    logger.info('Simulating VPN status check (CLI not available)');
    // Always return connected in simulation mode
    serverCache.statusCache = true;
    serverCache.statusTimestamp = Date.now();
    return true;
  },
  
  /**
   * Simulate VPN connect when CLI is not available
   * @param {string} country Country code
   * @returns {boolean} Simulated connection success
   */
  simulateVpnConnect(country) {
    logger.info(`Simulating VPN connect${country ? ' to ' + country : ''} (CLI not available)`);
    serverCache.currentServer = country ? `simulated-${country}` : 'simulated-server';
    serverCache.lastUsedCountry = country;
    serverCache.statusCache = true;
    return true;
  },
  
  /**
   * Simulate VPN disconnect when CLI is not available
   * @returns {boolean} Simulated disconnection success
   */
  simulateVpnDisconnect() {
    logger.info('Simulating VPN disconnect (CLI not available)');
    // We still "succeed" with the disconnect in simulation mode
    return true;
  },
  
  /**
   * Simulate IP rotation when CLI is not available
   * @param {boolean} forceRotation Whether this is a forced rotation
   * @returns {boolean} Simulated rotation success
   */
  simulateIpRotation(forceRotation = false) {
    logger.info(`Simulating IP rotation (CLI not available, forced=${forceRotation})`);
    
    // Choose a random country to simulate rotation
    const country = serverCache.countryCodes[Math.floor(Math.random() * serverCache.countryCodes.length)];
    
    // Update the server info
    serverCache.currentServer = `simulated-${country}`;
    serverCache.lastUsedCountry = country;
    serverCache.lastRotation = Date.now();
    
    // Reset block detection counter
    serverCache.blockDetectionCount = 0;
    
    // Use shorter delay for simulation to improve throughput
    const rotationDelay = forceRotation ? 1000 : 2000;
    
    // Delay to simulate connection time
    return new Promise(resolve => {
      setTimeout(() => {
        logger.info(`Simulated IP rotation complete (new server: ${serverCache.currentServer})`);
        resolve(true);
      }, rotationDelay);
    });
  },

  /**
   * Connect to NordVPN using a specific city
   * @param {string} city - City to connect to (or random city if not found)
   * @returns {Promise<boolean>} Connection success
   */
  async connectToCity(city) {
    // Ensure CLI is available before connecting
    if (await this.checkVpnCliAvailable() === false) {
      return this.simulateVpnConnect(city);
    }
    
    try {
      // Check if city exists in our list
      let targetCity = city;
      let foundCity = false;
      
      // Search for the city in our list
      Object.keys(serverCache.cities).forEach(region => {
        Object.keys(serverCache.cities[region]).forEach(country => {
          if (serverCache.cities[region][country].includes(city)) {
            foundCity = true;
          }
        });
      });
      
      // If city not found, pick a random US city
      if (!foundCity) {
        const preferredCountry = serverCache.preferredCountry;
        const preferredRegion = serverCache.preferredRegion;
        const citiesInCountry = serverCache.cities[preferredRegion][preferredCountry];
        
        if (citiesInCountry && citiesInCountry.length > 0) {
          const randomIndex = Math.floor(Math.random() * citiesInCountry.length);
          targetCity = citiesInCountry[randomIndex];
          logger.info(`City "${city}" not found, using random city: ${targetCity}`);
        } else {
          logger.warn(`No cities found for preferred country ${preferredCountry}`);
          return false;
        }
      }
      
      logger.info(`Connecting to NordVPN city: ${targetCity}`);
      
      // Execute NordVPN connect command with city parameter
      const nordvpnCommand = `"${serverCache.nordvpnPath}\\nordvpn" -c -g "${targetCity}"`;
      const { stdout, stderr } = await execAsync(nordvpnCommand);
      
      // Alternative if above doesn't work (command-line syntax)
      // const nordvpnCommand = `cd "${serverCache.nordvpnPath}" && nordvpn -c -g "${targetCity}"`;
      
      // Wait for connection to establish
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify connection status
      const isConnected = await this.isConnected();
      
      if (isConnected) {
        logger.info(`Successfully connected to NordVPN city: ${targetCity}`);
        
        // Update last used country for rotation purposes
        const currentCountry = await this.getCurrentCountry();
        if (currentCountry) {
          serverCache.lastUsedCountry = currentCountry;
        }
        
        return true;
      } else {
        logger.warn(`Failed to connect to NordVPN city: ${targetCity}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error connecting to NordVPN city ${city}: ${error.message}`);
      return this.simulateVpnConnect(city);
    }
  },
  
  /**
   * Get current connected country from NordVPN
   * @returns {Promise<string|null>} Currently connected country
   */
  async getCurrentCountry() {
    try {
      const { stdout } = await execAsync('nordvpn status');
      const match = stdout.match(/Country: ([^\r\n]+)/);
      return match ? match[1].trim() : null;
    } catch (error) {
      logger.error(`Error getting current country: ${error.message}`);
      return null;
    }
  },
  
  /**
   * Set NordVPN installation path
   * @param {string} path - Path to NordVPN installation directory
   */
  setNordVPNPath(path) {
    if (path && typeof path === 'string') {
      serverCache.nordvpnPath = path;
      logger.info(`NordVPN path set to: ${path}`);
    }
  },

  /**
   * Rotate VPN IP by connecting to a different city
   * @param {boolean} forceRotation Force rotation even if on cooldown
   * @returns {Promise<boolean>} Rotation success
   */
  async rotateIPByCity(forceRotation = false) {
    // Check rotation cooldown
    const now = Date.now();
    if (!forceRotation && (now - serverCache.lastRotation < serverCache.rotationCooldown)) {
      logger.info(`VPN rotation on cooldown. Waited only ${Math.round((now - serverCache.lastRotation) / 1000)}s since last rotation.`);
      return false;
    }

    // If CLI isn't available, simulate IP rotation
    if (await this.checkVpnCliAvailable() === false) {
      return this.simulateIpRotation();
    }
    
    try {
      logger.info('Rotating Nord VPN IP address by changing city...');
      
      // First disconnect
      await this.disconnect();
      
      // Wait a moment before reconnecting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get a random city from a random country
      const regionKeys = Object.keys(serverCache.cities);
      const randomRegion = regionKeys[Math.floor(Math.random() * regionKeys.length)];
      
      const countryKeys = Object.keys(serverCache.cities[randomRegion]);
      const randomCountry = countryKeys[Math.floor(Math.random() * countryKeys.length)];
      
      const cities = serverCache.cities[randomRegion][randomCountry];
      const randomCity = cities[Math.floor(Math.random() * cities.length)];
      
      // Connect to new city
      const connected = await this.connectToCity(randomCity);
      
      if (connected) {
        // Update last rotation time
        serverCache.lastRotation = Date.now();
        logger.info(`Successfully rotated VPN IP to city: ${randomCity}`);
        
        // Reset block detection counter
        serverCache.blockDetectionCount = 0;
        return true;
      } else {
        // Try regular rotation as fallback
        logger.warn('Failed to rotate by city, falling back to regular rotation');
        return this.rotateIP(forceRotation);
      }
    } catch (error) {
      logger.error(`Error rotating VPN IP by city: ${error.message}`);
      return this.simulateIpRotation();
    }
  },

  /**
   * Find the NordVPN executable path on the system
   * @returns {Promise<string|null>} Path to NordVPN executable or null if not found
   */
  async findNordVPNPath() {
    // If we already found the path, return it
    if (serverCache.vpnExecutablePath) {
      return serverCache.vpnExecutablePath;
    }

    // Common installation paths for NordVPN on Windows
    const possiblePaths = [
      'C:\\Program Files\\NordVPN\\nordvpn.exe',
      'C:\\Program Files (x86)\\NordVPN\\nordvpn.exe',
      path.join(process.env.LOCALAPPDATA, 'Programs', 'NordVPN', 'nordvpn.exe'),
      path.join(process.env.PROGRAMFILES, 'NordVPN', 'nordvpn.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'NordVPN', 'nordvpn.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'NordVPN', 'nordvpn.exe'),
      // Try the CLI executable
      'C:\\Program Files\\NordVPN\\NordVPN.exe',
      'C:\\Program Files (x86)\\NordVPN\\NordVPN.exe',
      // Try additional paths
      path.join(serverCache.nordvpnPath, 'nordvpn.exe'),
      path.join(serverCache.nordvpnPath, 'NordVPN.exe')
    ];

    logger.info('Searching for NordVPN executable...');

    for (const testPath of possiblePaths) {
      try {
        if (fs.existsSync(testPath)) {
          logger.info(`Found NordVPN executable at: ${testPath}`);
          serverCache.vpnExecutablePath = testPath;
          return testPath;
        }
      } catch (e) {
        // Ignore file access errors
      }
    }
    
    logger.warn('NordVPN executable not found in common locations');
    return null;
  },

  /**
   * Connect to NordVPN city using direct executable call
   */
  async connectToCity(city) {
    // First try to find the NordVPN executable
    const vpnPath = await this.findNordVPNPath();
    
    if (!vpnPath) {
      logger.warn('Could not find NordVPN executable, attempting simulation');
      return this.simulateVpnConnect(city);
    }
    
    try {
      // Check if city exists in our list
      let targetCity = city;
      let foundCity = false;
      
      // Search for the city in our list
      Object.keys(serverCache.cities).forEach(region => {
        Object.keys(serverCache.cities[region]).forEach(country => {
          if (serverCache.cities[region][country].includes(city)) {
            foundCity = true;
          }
        });
      });
      
      // If city not found, pick a random US city
      if (!foundCity) {
        const preferredCountry = serverCache.preferredCountry;
        const preferredRegion = serverCache.preferredRegion;
        const citiesInCountry = serverCache.cities[preferredRegion][preferredCountry];
        
        if (citiesInCountry && citiesInCountry.length > 0) {
          const randomIndex = Math.floor(Math.random() * citiesInCountry.length);
          targetCity = citiesInCountry[randomIndex];
          logger.info(`City "${city}" not found, using random city: ${targetCity}`);
        } else {
          logger.warn(`No cities found for preferred country ${preferredCountry}`);
          return false;
        }
      }
      
      logger.info(`Connecting to NordVPN city: ${targetCity}`);
      
      // Use direct executable call with full path
      const cmdResult = await execAsync(`"${vpnPath}" -c -g "${targetCity}"`);
      logger.info(`NordVPN connection result: ${cmdResult.stdout}`);
      
      // Wait for connection to establish
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify connection status
      const isConnected = await this.checkVpnStatus();
      
      if (isConnected) {
        logger.info(`Successfully connected to NordVPN city: ${targetCity}`);
        
        // Update status cache
        serverCache.statusCache = true;
        serverCache.statusTimestamp = Date.now();
        serverCache.currentServer = targetCity;
        
        return true;
      } else {
        logger.warn(`Failed to connect to NordVPN city: ${targetCity}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error connecting to NordVPN city ${city}: ${error.message}`);
      
      // Try using the NordVPN application directly via the shell
      try {
        logger.info(`Attempting alternate connection method for city: ${city}`);
        
        // Try with system-wide command (might work if nordvpn is in the PATH)
        await execAsync(`start nordvpn -c -g "${city}"`);
        
        // Wait longer for this connection method
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check connection
        const connected = await this.checkVpnStatus();
        if (connected) {
          logger.info(`Successfully connected to ${city} using alternate method`);
          return true;
        }
      } catch (alternateError) {
        logger.error(`Alternate connection method failed: ${alternateError.message}`);
      }
      
      return this.simulateVpnConnect(city);
    }
  },
  
  /**
   * Check actual VPN connection status using multiple methods
   */
  async checkVpnStatus() {
    try {
      // Method 1: Try direct NordVPN status command
      try {
        const { stdout } = await execAsync('nordvpn status');
        if (stdout.includes('Connected')) {
          return true;
        }
      } catch (e) {
        // Failed with nordvpn command, try next method
      }
      
      // Method 2: Check IP info for VPN indicators
      try {
        const ipInfo = await this.getIPInfo();
        if (ipInfo && ipInfo.org && 
            (ipInfo.org.toLowerCase().includes('nord') || 
             ipInfo.org.toLowerCase().includes('vpn'))) {
          return true;
        }
      } catch (e) {
        // IP check failed, try next method
      }
      
      // Method 3: Try to find the NordVPN process in the system
      try {
        const { stdout } = await execAsync('tasklist /fi "imagename eq nordvpn*"');
        if (stdout.toLowerCase().includes('nordvpn')) {
          return true;
        }
      } catch (e) {
        // Process check failed, assume not connected
      }
      
      return false;
    } catch (error) {
      logger.error(`Error checking VPN status: ${error.message}`);
      return false;
    }
  },

  /**
   * Rotate VPN IP with enhanced connectivity and fallbacks
   */
  async rotateIP(forceRotation = false) {
    // Check rotation cooldown - use shorter cooldown for simulation mode
    const now = Date.now();
    const isSimulated = await this.checkVpnCliAvailable() === false;
    const cooldownPeriod = isSimulated ? serverCache.simulationCooldown : serverCache.rotationCooldown;
    
    if (!forceRotation && (now - serverCache.lastRotation < cooldownPeriod)) {
      logger.info(`VPN rotation on cooldown. Waited only ${Math.round((now - serverCache.lastRotation) / 1000)}s since last rotation (${cooldownPeriod/1000}s needed).`);
      
      // For simulation mode with high block detection count, bypass cooldown
      if (isSimulated && serverCache.blockDetectionCount > 5) {
        logger.info('High block detection count, bypassing cooldown in simulation mode');
        forceRotation = true;
      } else {
        return false;
      }
    }

    // If CLI isn't available or simulation is forced, simulate IP rotation
    if (isSimulated) {
      return this.simulateIpRotation(forceRotation);
    }
    
    try {
      logger.info('Rotating Nord VPN IP address...');
      
      // Try to use city rotation for better IP changes
      const cityRotated = await this.rotateIPByCity(forceRotation);
      if (cityRotated) {
        logger.info('Successfully rotated VPN IP using city rotation');
        serverCache.lastRotation = Date.now();
        serverCache.blockDetectionCount = 0;
        return true;
      }
      
      // If city rotation failed, try regular rotation
      logger.info('City rotation failed, trying regular rotation');
      
      // First disconnect
      const disconnected = await this.disconnect();
      if (!disconnected) {
        logger.warn('Failed to disconnect from VPN, attempting forced disconnect');
        // Try forced disconnect
        try {
          await execAsync('"C:\\Program Files\\NordVPN\\nordvpn.exe" -d');
        } catch (e) {
          // Ignore errors
        }
      }
      
      // Wait a moment before reconnecting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Select a country different from the last one used
      let country = null;
      if (serverCache.countryCodes.length > 1) {
        const availableCountries = serverCache.countryCodes.filter(
          c => c !== serverCache.lastUsedCountry
        );
        
        if (availableCountries.length > 0) {
          country = availableCountries[Math.floor(Math.random() * availableCountries.length)];
        }
      }
      
      // Try direct connection using the executable path
      const vpnPath = await this.findNordVPNPath();
      let connected = false;
      
      if (vpnPath) {
        try {
          logger.info(`Connecting to NordVPN country ${country} using direct executable call`);
          const connectCmd = country ? `"${vpnPath}" -c ${country}` : `"${vpnPath}" -c`;
          await execAsync(connectCmd);
          
          // Wait for connection to establish
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Check connection
          connected = await this.checkVpnStatus();
        } catch (e) {
          logger.warn(`Direct executable connection failed: ${e.message}`);
        }
      }
      
      // If direct connection failed, try through connect method
      if (!connected) {
        connected = await this.connect(country);
      }
      
      if (connected) {
        // Update last rotation time
        serverCache.lastRotation = Date.now();
        logger.info(`Successfully rotated VPN IP address to ${serverCache.currentServer || 'new server'}`);
        
        // Reset block detection counter
        serverCache.blockDetectionCount = 0;
        
        return true;
      } else {
        logger.error('Failed to rotate VPN IP address');
        return false;
      }
    } catch (error) {
      logger.error(`Error rotating VPN IP: ${error.message}`);
      return this.simulateIpRotation();
    }
  },
};

module.exports = vpnUtils;
