/**
 * Email Finder Testing Tool
 * 
 * This script allows testing the email finder with a specific domain using all strategies.
 * Usage: node scripts/test-email-finder.js <domain>
 * Example: node scripts/test-email-finder.js geeks5g.com
 * 
 * Options:
 *   --save              Save found email to database (requires --id)
 *   --id <business_id>  Specify business ID to update
 *   --engine <engine>   Specify search engine (google, bing, duckduckgo)
 *   --debug             Enable verbose debugging and screenshots
 *   --all               Try all search engines sequentially
 * 
 * Examples:
 *   node scripts/test-email-finder.js geeks5g.com --debug
 *   node scripts/test-email-finder.js geeks5g.com --save --id 123
 *   node scripts/test-email-finder.js geeks5g.com --all
 */

const emailFinder = require('../emailFinder');
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  
  fg: {
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m'
  },
  
  bg: {
    black: '\x1b[40m',
    red: '\x1b[41m',
    green: '\x1b[42m',
    yellow: '\x1b[43m',
    blue: '\x1b[44m',
    magenta: '\x1b[45m',
    cyan: '\x1b[46m',
    white: '\x1b[47m'
  }
};

// Override console for better formatting
const customLog = console.log;
console.log = function(msg, ...args) {
  if (typeof msg === 'string' && msg.startsWith('[')) {
    const type = msg.substring(1, msg.indexOf(']'));
    let coloredType;
    
    switch(type) {
      case 'INFO':
        coloredType = colors.fg.green + '[INFO]' + colors.reset;
        break;
      case 'WARN':
        coloredType = colors.fg.yellow + '[WARN]' + colors.reset;
        break;
      case 'ERROR':
        coloredType = colors.fg.red + '[ERROR]' + colors.reset;
        break;
      default:
        coloredType = msg.substring(0, msg.indexOf(']') + 1);
    }
    
    customLog(coloredType + msg.substring(msg.indexOf(']') + 1), ...args);
  } else {
    customLog(msg, ...args);
  }
};

/**
 * Test the email finder on a specific domain
 */
async function testDomain(domain, options = {}) {
  const startTime = Date.now();
  
  console.log(`[INFO] ${colors.bright}Starting email search for domain: ${domain}${colors.reset}`);
  
  // Parse and validate the domain
  if (!domain) {
    console.error(`[ERROR] No domain provided. Usage: node test-email-finder.js <domain>`);
    process.exit(1);
  }
  
  // Clean up the domain if needed
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  
  try {
    // Initialize the email finder
    console.log(`[INFO] Initializing email finder...`);
    await emailFinder.initialize();
    
    // Define test options
    const testOptions = {
      takeScreenshots: options.debug || false,
      useSearchEngines: true,
      searchEngine: options.engine || 'google',
      timeout: 60000,
      businessId: options.id || null,
      saveToDatabase: options.save || false
    };
    
    // Log the options
    console.log(`[INFO] Testing with options:`, JSON.stringify(testOptions, null, 2));
    
    // STRATEGY 1: Try direct website extraction first
    console.log(`\n${colors.bg.blue}${colors.fg.white} STRATEGY 1: DIRECT WEBSITE ${colors.reset}`);
    console.log(`[INFO] Testing direct website extraction on: https://${cleanDomain}`);
    
    let directEmails = [];
    try {
      directEmails = await emailFinder.extractEmailsFromWebsite(`https://${cleanDomain}`, {
        ...testOptions,
        useSearchEngines: false
      }, 0);
      
      if (directEmails && directEmails.length > 0) {
        console.log(`[INFO] ${colors.fg.green}SUCCESS! Found ${directEmails.length} emails directly on website:${colors.reset}`);
        directEmails.forEach(email => console.log(`  - ${email}`));
      } else {
        console.log(`[INFO] ${colors.fg.yellow}No emails found directly on the main website${colors.reset}`);
      }
    } catch (error) {
      console.error(`[ERROR] Failed to extract emails directly: ${error.message}`);
    }
    
    // STRATEGY 2: Try contact pages
    console.log(`\n${colors.bg.blue}${colors.fg.white} STRATEGY 2: CONTACT PAGES ${colors.reset}`);
    console.log(`[INFO] Checking common contact page URLs...`);
    
    const contactUrls = [
      `https://${cleanDomain}/contact`,
      `https://${cleanDomain}/contact-us`,
      `https://${cleanDomain}/about-us`,
      `https://www.${cleanDomain}/contact`,
      `https://${cleanDomain}/support`,
      `https://${cleanDomain}/get-in-touch`
    ];
    
    let contactEmails = [];
    for (const url of contactUrls) {
      try {
        console.log(`[INFO] Checking ${url}`);
        const emails = await emailFinder.extractEmailsFromWebsite(url, {
          ...testOptions,
          useSearchEngines: false,
          timeout: 20000 // Shorter timeout for contact pages
        }, 0);
        
        if (emails && emails.length > 0) {
          console.log(`[INFO] ${colors.fg.green}Found ${emails.length} emails on ${url}:${colors.reset}`);
          emails.forEach(email => console.log(`  - ${email}`));
          contactEmails = [...contactEmails, ...emails];
          break; // Exit once we find emails
        }
      } catch (error) {
        console.log(`[INFO] No emails found on ${url}: ${error.message}`);
      }
    }
    
    // If no emails found yet, try search engines
    let searchEmails = [];
    if ((!directEmails || directEmails.length === 0) && 
        (!contactEmails || contactEmails.length === 0)) {
      
      // STRATEGY 3: Use search engines as last resort
      if (options.all) {
        // Try all search engines sequentially
        const engines = ['google', 'bing', 'duckduckgo'];
        console.log(`\n${colors.bg.blue}${colors.fg.white} STRATEGY 3: ALL SEARCH ENGINES ${colors.reset}`);
        
        for (const engine of engines) {
          console.log(`\n[INFO] Testing search engine: ${engine.toUpperCase()}`);
          try {
            const engineEmails = await emailFinder.searchEngineEmailDiscovery(cleanDomain, {
              ...testOptions,
              searchEngine: engine
            }, 0);
            
            if (engineEmails && engineEmails.length > 0) {
              console.log(`[INFO] ${colors.fg.green}SUCCESS! Found ${engineEmails.length} emails using ${engine}:${colors.reset}`);
              engineEmails.forEach(email => console.log(`  - ${email}`));
              searchEmails = [...searchEmails, ...engineEmails];
            } else {
              console.log(`[INFO] ${colors.fg.yellow}No emails found using ${engine}${colors.reset}`);
            }
          } catch (error) {
            console.error(`[ERROR] Failed to extract emails using ${engine}: ${error.message}`);
          }
        }
      } else {
        // Just try the specified search engine
        const engine = testOptions.searchEngine;
        console.log(`\n${colors.bg.blue}${colors.fg.white} STRATEGY 3: SEARCH ENGINE (${engine.toUpperCase()}) ${colors.reset}`);
        
        try {
          searchEmails = await emailFinder.searchEngineEmailDiscovery(cleanDomain, testOptions, 0);
          
          if (searchEmails && searchEmails.length > 0) {
            console.log(`[INFO] ${colors.fg.green}SUCCESS! Found ${searchEmails.length} emails using ${engine}:${colors.reset}`);
            searchEmails.forEach(email => console.log(`  - ${email}`));
          } else {
            console.log(`[INFO] ${colors.fg.yellow}No emails found using ${engine}${colors.reset}`);
          }
        } catch (error) {
          console.error(`[ERROR] Failed to extract emails using ${engine}: ${error.message}`);
        }
      }
    }
    
    // Combine all found emails
    const allEmails = [...directEmails, ...contactEmails, ...searchEmails];
    const uniqueEmails = [...new Set(allEmails)];
    
    // Prioritize emails
    const prioritizedEmails = emailFinder.prioritizeEmails(uniqueEmails, cleanDomain);
    
    console.log(`\n${colors.bg.green}${colors.fg.black} SUMMARY ${colors.reset}`);
    console.log(`[INFO] Search completed in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
    
    if (prioritizedEmails.length > 0) {
      console.log(`[INFO] ${colors.bright}Found ${prioritizedEmails.length} unique emails:${colors.reset}`);
      prioritizedEmails.forEach((email, index) => {
        if (index === 0) {
          console.log(`  ${colors.bright}${colors.fg.green}✓ ${email} (Highest priority)${colors.reset}`);
        } else {
          console.log(`  - ${email}`);
        }
      });
      
      // If user requested database save and we have a business ID
      if (options.save && options.id) {
        console.log(`\n[INFO] Saving best email to database for business ID: ${options.id}`);
        try {
          const saveResult = await emailFinder.saveEmailToDatabase(
            options.id, 
            prioritizedEmails[0],
            prioritizedEmails.join(', ')
          );
          
          if (saveResult) {
            console.log(`[INFO] ${colors.fg.green}Successfully saved email ${prioritizedEmails[0]} to database${colors.reset}`);
          } else {
            console.error(`[ERROR] Failed to save email to database`);
          }
        } catch (error) {
          console.error(`[ERROR] Database save error: ${error.message}`);
        }
      }
      
      return { success: true, emails: prioritizedEmails };
    } else {
      console.log(`[INFO] ${colors.fg.yellow}No emails found for ${domain}${colors.reset}`);
      return { success: false };
    }
    
  } catch (error) {
    console.error(`[ERROR] Test failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    // Clean up resources
    console.log(`[INFO] Closing email finder resources...`);
    await emailFinder.close().catch(e => console.warn(`[WARN] Error closing resources: ${e.message}`));
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const domain = args[0];

// Extract options
const options = {
  debug: args.includes('--debug'),
  save: args.includes('--save'),
  all: args.includes('--all'),
  engine: args.includes('--engine') ? args[args.indexOf('--engine') + 1] : 'google'
};

// Get business ID if provided
if (args.includes('--id')) {
  const idIndex = args.indexOf('--id');
  options.id = args[idIndex + 1];
}

// Validate options
if (options.save && !options.id) {
  console.error(`[ERROR] To save to database (--save), you must provide a business ID (--id <ID>)`);
  process.exit(1);
}

// Run the test
if (domain) {
  console.log(`${colors.bright}Email Finder Testing Tool${colors.reset}`);
  console.log(`Domain: ${domain}`);
  
  testDomain(domain, options).then(() => {
    process.exit(0);
  }).catch(error => {
    console.error(`[ERROR] Unhandled error: ${error.message}`);
    process.exit(1);
  });
} else {
  console.log(`
${colors.bright}Email Finder Testing Tool${colors.reset}

Usage: node scripts/test-email-finder.js <domain> [options]

Options:
  --save              Save found email to database (requires --id)
  --id <business_id>  Specify business ID to update
  --engine <engine>   Specify search engine (google, bing, duckduckgo)
  --debug             Enable verbose debugging and screenshots
  --all               Try all search engines sequentially

Examples:
  node scripts/test-email-finder.js geeks5g.com --debug
  node scripts/test-email-finder.js geeks5g.com --save --id 123
  node scripts/test-email-finder.js geeks5g.com --all
  `);
  process.exit(1);
}
