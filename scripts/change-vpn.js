/**
 * NordVPN IP Rotation Utility
 * Command line tool to change your NordVPN IP address
 * 
 * Usage:
 *   node change-vpn.js          - Rotate to a random server
 *   node change-vpn.js us       - Connect to a US server
 *   node change-vpn.js status   - Show current connection status
 *   node change-vpn.js ip       - Show current IP information
 */

const vpnUtils = require('../vpn-utils');

// Simple logger for script
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};

// Process command line arguments
const args = process.argv.slice(2);
const command = args[0] || 'rotate';

async function main() {
  try {
    // Initialize VPN utilities
    await vpnUtils.initialize();
    
    switch (command.toLowerCase()) {
      case 'rotate':
        logger.info('Rotating VPN IP address...');
        const rotated = await vpnUtils.rotateIP(true); // Force rotation
        
        if (rotated) {
          logger.info('✓ Successfully rotated VPN IP address');
          
          // Show new IP info
          const ipInfo = await vpnUtils.getIPInfo();
          if (ipInfo) {
            logger.info(`New IP Address: ${ipInfo.ip}`);
            logger.info(`Location: ${ipInfo.city}, ${ipInfo.region}, ${ipInfo.country}`);
            logger.info(`ISP: ${ipInfo.org}`);
          }
        } else {
          logger.error('✗ Failed to rotate VPN IP address');
        }
        break;
        
      case 'status':
        const isConnected = await vpnUtils.isConnected();
        // Get status without directly accessing serverCache
        const statusInfo = await vpnUtils.getIPInfo();
        
        if (isConnected) {
          logger.info(`✓ VPN is connected`);
          if (statusInfo) {
            logger.info(`Current server: ${statusInfo.org}`);
            logger.info(`IP: ${statusInfo.ip} (${statusInfo.city}, ${statusInfo.country})`);
          }
        } else {
          logger.info('✗ VPN is not connected');
        }
        break;
        
      case 'ip':
        const ipInfo = await vpnUtils.getIPInfo();
        if (ipInfo) {
          logger.info('Current IP Information:');
          logger.info(`IP Address: ${ipInfo.ip}`);
          logger.info(`Location: ${ipInfo.city}, ${ipInfo.region}, ${ipInfo.country}`);
          logger.info(`ISP: ${ipInfo.org}`);
        } else {
          logger.error('Failed to retrieve IP information');
        }
        break;
        
      default:
        // Treat as country code
        logger.info(`Connecting to VPN using country code: ${command}`);
        const connected = await vpnUtils.connect(command);
        
        if (connected) {
          logger.info(`✓ Successfully connected to ${command.toUpperCase()}`);
          
          // Show new IP info
          const newIpInfo = await vpnUtils.getIPInfo();
          if (newIpInfo) {
            logger.info(`New IP Address: ${newIpInfo.ip}`);
            logger.info(`Location: ${newIpInfo.city}, ${newIpInfo.region}, ${newIpInfo.country}`);
          }
        } else {
          logger.error(`✗ Failed to connect to ${command.toUpperCase()}`);
        }
        break;
    }
    
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
main().then(() => {
  process.exit(0);
}).catch(err => {
  logger.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
