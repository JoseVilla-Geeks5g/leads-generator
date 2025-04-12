/**
 * Script to update the formatted_phone field for all business listings
 * This cleans phone numbers to contain only digits with a leading '1' for US/Canada numbers
 */

const db = require('../database');
const logger = require('../logger') || console;

async function updateFormattedPhoneNumbers() {
  try {
    logger.info('Starting formatted phone number update');
    
    // Initialize the database connection
    await db.init();
    
    // Ensure the formatted_phone column exists
    const columnExists = await checkColumnExists('business_listings', 'formatted_phone');
    if (!columnExists) {
      logger.info('Adding formatted_phone column to business_listings table');
      await db.query(`ALTER TABLE business_listings ADD COLUMN formatted_phone VARCHAR(20)`);
      
      // Create an index for the new column
      logger.info('Creating index on formatted_phone column');
      await db.query(`CREATE INDEX idx_business_listings_formatted_phone ON business_listings(formatted_phone)`);
    }
    
    // Count how many records need updating
    const countResult = await db.query(`
      SELECT COUNT(*) as total FROM business_listings 
      WHERE phone IS NOT NULL AND phone != ''
    `);
    const totalRecords = parseInt(countResult.rows[0].total);
    
    logger.info(`Found ${totalRecords} business listings with phone numbers to format`);
    
    // Update all records in a single operation for efficiency
    logger.info('Updating formatted_phone column for all records');
    const updateResult = await db.query(`
      UPDATE business_listings
      SET formatted_phone = CASE
        WHEN phone IS NULL OR phone = '' THEN NULL
        ELSE 
          -- First remove all non-digit characters
          REGEXP_REPLACE(
            REGEXP_REPLACE(phone, '[^0-9]', '', 'g'),
            -- Then ensure US/Canada numbers start with '1'
            '^([2-9][0-9]{9})$', '1\\1', 'g'
          )
      END,
      updated_at = NOW()
      WHERE phone IS NOT NULL AND phone != ''
      RETURNING COUNT(*) as updated
    `);
    
    // Get the count of updated records
    const updatedResult = await db.query(`
      SELECT COUNT(*) as count FROM business_listings 
      WHERE formatted_phone IS NOT NULL AND formatted_phone != ''
    `);
    const updatedCount = parseInt(updatedResult.rows[0].count);
    
    logger.info(`Updated ${updatedCount} records with formatted phone numbers`);
    
    // Validate some examples to show the formatting worked
    const examples = await db.query(`
      SELECT id, phone, formatted_phone 
      FROM business_listings 
      WHERE phone IS NOT NULL AND phone != '' 
      ORDER BY RANDOM() 
      LIMIT 5
    `);
    
    logger.info('Example of updated records:');
    examples.rows.forEach(row => {
      logger.info(`ID: ${row.id}, Original: ${row.phone}, Formatted: ${row.formatted_phone}`);
    });
    
    logger.info('Formatted phone number update completed successfully');
    return true;
  } catch (error) {
    logger.error(`Error updating formatted phone numbers: ${error.message}`);
    return false;
  }
}

// Helper function to check if a column exists
async function checkColumnExists(tableName, columnName) {
  const result = await db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns 
      WHERE table_name = $1 AND column_name = $2
    )
  `, [tableName, columnName]);
  return result.rows[0].exists;
}

// Run the function if this script is executed directly
if (require.main === module) {
  updateFormattedPhoneNumbers()
    .then(success => {
      if (success) {
        logger.info('Script completed successfully');
        process.exit(0);
      } else {
        logger.error('Script failed');
        process.exit(1);
      }
    })
    .catch(error => {
      logger.error(`Unhandled error: ${error.message}`);
      process.exit(1);
    });
}

module.exports = updateFormattedPhoneNumbers;
