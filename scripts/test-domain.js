/**
 * Email Finder Domain Testing Utility - Fixed version
 */

const emailFinder = require('../emailFinder');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Custom logger
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  success: (msg) => console.log(`${colors.green}[SUCCESS] ${msg}${colors.reset}`),
  warn: (msg) => console.warn(`${colors.yellow}[WARN] ${msg}${colors.reset}`),
  error: (msg) => console.error(`${colors.red}[ERROR] ${msg}${colors.reset}`),
  debug: (msg, options = {}) => options.debug && console.log(`${colors.dim}[DEBUG] ${msg}${colors.reset}`)
};

// Parse command line arguments
const args = process.argv.slice(2);
const domain = args[0];

const options = {
  debug: args.includes('--debug'),
  save: args.includes('--save'),
  verbose: args.includes('--verbose') || args.includes('--debug'),
  engine: args.includes('--engine') ? args[args.indexOf('--engine') + 1] : 'google',
  all: args.includes('--all'),
  id: args.includes('--id') ? args[args.indexOf('--id') + 1] : null
};

// Function to test a domain with just one engine
async function testDomain(domain, testOptions = {}) {
  try {
    if (!domain) {
      logger.error(`No domain provided. Usage: node ${require('path').basename(__filename)} <domain>`);
      process.exit(1);
    }

    // Convert domain to proper format
    let fullUrl = domain;
    if (!fullUrl.startsWith('http')) {
      fullUrl = 'https://' + fullUrl;
    }

    // Initialize email finder
    logger.info(`Initializing email finder for ${fullUrl}`);
    await emailFinder.initialize();

    // Get business ID if provided
    const businessId = testOptions.id ? testOptions.id : null;

    // Configure email finder options
    const emailFinderOptions = {
      takeScreenshots: testOptions.debug,
      useSearchEngines: true,
      searchEngine: testOptions.engine || 'google',
      timeout: 45000,
      maxRetries: 2,
      businessId: businessId, // Ensure business ID is passed correctly
      saveToDatabase: !!businessId && testOptions.save === true, // Only save if ID is provided AND save flag is set
      debug: testOptions.debug
    };

    if (emailFinderOptions.saveToDatabase) {
      logger.info(`Will save found email to database for business ID: ${businessId}`);
    } else {
      logger.info(`Will NOT save to database. businessId=${businessId || 'not provided'}, saveFlag=${testOptions.save}`);
    }

    // Run email finder with standard approach first
    logger.info(`Searching for email on ${fullUrl} using ${emailFinderOptions.searchEngine}`);
    const startTime = Date.now();
    
    const email = await emailFinder.findEmail(fullUrl, emailFinderOptions);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Check and display the result
    if (email) {
      const source = emailFinder.lastExtractedEmailSources?.get(email.toLowerCase()) || 'unknown';
      logger.success(`Found email: ${colors.bright}${email}${colors.reset} (source: ${source}) in ${duration}s`);
      
      if (emailFinderOptions.saveToDatabase) {
        logger.info(`Email was${emailFinderOptions.saveToDatabase ? '' : ' NOT'} saved to database for ID: ${businessId}`);
      }
      
      return { success: true, email, source, duration };
    } else {
      logger.warn(`No email found for ${fullUrl} after ${duration}s`);
      
      // Special handling for geeks5g.com domain
      if (domain.includes('geeks5g.com')) {
        logger.info(`Special handling for geeks5g.com domain...`);
        logger.info(`Known email for geeks5g.com is info@geeks5g.com`);
        return { 
          success: false, 
          suggestedEmail: 'info@geeks5g.com',
          message: 'This domain requires special handling' 
        };
      }
      
      return { success: false, duration };
    }
  } catch (error) {
    logger.error(`Failed to find email: ${error.message}`);
    if (testOptions.debug) {
      console.error(error);
    }
    return { success: false, error: error.message };
  } finally {
    // Cleanup resources
    await emailFinder.close().catch(e => logger.warn(`Error during cleanup: ${e.message}`));
  }
}

// Function to test with multiple search engines
async function testAllEngines(domain) {
  const engines = ['google', 'bing', 'duckduckgo'];
  let anySuccess = false;
  const results = {};
  
  console.log(`\n${colors.cyan}${colors.bright}Email Finder Domain Test${colors.reset}`);
  console.log(`Domain: ${colors.bright}${domain}${colors.reset}`);
  console.log(`Options: ${JSON.stringify(options)}\n`);
  
  for (const engine of engines) {
    logger.info(`\n${colors.cyan}${colors.bright}Testing with ${engine.toUpperCase()}${colors.reset}`);
    try {
      // Initialize fresh for each engine
      await emailFinder.close().catch(() => {});
      
      const engineResult = await testDomain(domain, { ...options, engine });
      results[engine] = engineResult;
      
      if (engineResult.success) {
        anySuccess = true;
        if (!options.all) break;
      }
      
      // Wait between engines
      if (engines.indexOf(engine) < engines.length - 1) {
        logger.info(`Waiting a few seconds before trying next engine...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (error) {
      logger.error(`Failed with ${engine}: ${error.message}`);
      results[engine] = { success: false, error: error.message };
    }
  }
  
  // Summary
  logger.info(`\n${colors.cyan}${colors.bright}=== RESULTS SUMMARY ===${colors.reset}`);
  for (const [engine, result] of Object.entries(results)) {
    if (result.success) {
      logger.success(`${engine.toUpperCase()}: Found email ${result.email}`);
    } else {
      logger.warn(`${engine.toUpperCase()}: No email found${result.error ? ' (error: ' + result.error + ')' : ''}`);
    }
  }
  
  return { success: anySuccess, results };
}

// Run the test
if (domain) {
  if (options.all) {
    testAllEngines(domain)
      .catch(err => {
        logger.error(`Test failed: ${err.message}`);
        process.exit(1);
      })
      .finally(() => process.exit(0));
  } else {
    testDomain(domain, options)
      .catch(err => {
        logger.error(`Test failed: ${err.message}`);
        process.exit(1);
      })
      .finally(() => process.exit(0));
  }
} else {
  console.log(`
${colors.bright}Email Finder Domain Testing Utility${colors.reset}

Usage: node scripts/test-domain.js <domain> [options]

Options:
  --debug          Enable debug mode with verbose output
  --save           Save found email to database (requires --id)
  --id <id>        Business ID to update
  --verbose        Show more details about the process
  --engine <name>  Specify search engine (google, bing, duckduckgo)
  --all            Try all search engines one after another

Examples:
  node scripts/test-domain.js example.com
  node scripts/test-domain.js example.com --debug
  node scripts/test-domain.js example.com --all
  `);
  process.exit(1);
}
