const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const db = require('../lib/database');
const logger = require('../lib/logger');

class ExportService {
  constructor() {
    this.exportDirectory = path.resolve(process.cwd(), 'exports');
    
    // Create exports directory if it doesn't exist
    if (!fs.existsSync(this.exportDirectory)) {
      fs.mkdirSync(this.exportDirectory, { recursive: true });
    }
  }

  async exportTaskResults(taskId) {
    try {
      // Get task information
      const task = await db.getOne('SELECT * FROM scraping_tasks WHERE id = $1', [taskId]);
      
      if (!task) {
        throw new Error('Task not found');
      }

      // Get businesses for this task
      const businesses = await this.getBusinessesForTask(task.search_term);
      
      if (businesses.length === 0) {
        throw new Error('No businesses found for this task');
      }

      const filename = `${task.search_term.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      const filepath = path.join(this.exportDirectory, filename);
      
      await this.createExcelFile(businesses, filepath, task.search_term);
      
      return {
        filename,
        filepath,
        count: businesses.length
      };
    } catch (error) {
      logger.error(`Error exporting task results: ${error.message}`);
      throw error;
    }
  }

  async exportAllBusinesses() {
    try {
      // Get all businesses
      const businesses = await db.getMany(
        'SELECT * FROM business_listings ORDER BY search_term, name', 
        []
      );
      
      if (businesses.length === 0) {
        throw new Error('No businesses found in the database');
      }
      
      // Create a descriptive filename with date and time
      const dateTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const filename = `All_Businesses_${dateTime}.xlsx`;
      const filepath = path.join(this.exportDirectory, filename);
      
      await this.createExcelFile(businesses, filepath, "All Businesses");
      
      return {
        filename,
        filepath,
        count: businesses.length
      };
    } catch (error) {
      logger.error(`Error exporting all businesses: ${error.message}`);
      throw error;
    }
  }

  async exportBusinessesByState(state) {
    try {
      // Get businesses for the specified state
      const businesses = await db.getMany(
        `SELECT * FROM business_listings 
         WHERE state = $1 OR search_term LIKE $2
         ORDER BY city, name`, 
        [state, `%- ${state}%`]
      );
      
      if (businesses.length === 0) {
        throw new Error(`No businesses found for state: ${state}`);
      }
      
      const filename = `${state}_Businesses_${new Date().toISOString().split('T')[0]}.xlsx`;
      const filepath = path.join(this.exportDirectory, filename);
      
      await this.createExcelFile(businesses, filepath, `Businesses in ${state}`);
      
      return {
        filename,
        filepath,
        count: businesses.length
      };
    } catch (error) {
      logger.error(`Error exporting businesses for state ${state}: ${error.message}`);
      throw error;
    }
  }

  async getBusinessesForTask(searchTerm) {
    try {
      return await db.getMany(
        'SELECT * FROM business_listings WHERE search_term = $1 ORDER BY name', 
        [searchTerm]
      );
    } catch (error) {
      logger.error(`Error getting businesses for task: ${error.message}`);
      throw error;
    }
  }

  async createExcelFile(businesses, filepath, title) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Business Scraper Bot';
    workbook.lastModifiedBy = 'Business Scraper Bot';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    workbook.properties.title = title;
    
    const worksheet = workbook.addWorksheet('Businesses', {
      properties: { tabColor: { argb: '4167B8' } },
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
    });
    
    // Define columns with improved formatting
    worksheet.columns = [
      { header: 'Name', key: 'name', width: 30, style: { alignment: { wrapText: true } } },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Website', key: 'website', width: 30 },
      { header: 'Phone', key: 'phone', width: 20 },
      { header: 'Address', key: 'address', width: 40, style: { alignment: { wrapText: true } } },
      { header: 'City', key: 'city', width: 20 },
      { header: 'State', key: 'state', width: 15 },
      { header: 'Country', key: 'country', width: 15 },
      { header: 'Rating', key: 'rating', width: 10 },
      { header: 'Search Term', key: 'search_term', width: 30 },
      { header: 'Scraped', key: 'search_date', width: 20 },
      { header: 'Verified', key: 'verified', width: 10 },
      { header: 'Contacted', key: 'contacted', width: 10 }
    ];
    
    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '4167B8' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 22;
    
    // Add rows with proper data type handling
    businesses.forEach(business => {
      // Format date in a readable way if available
      let formattedDate = business.search_date;
      if (business.search_date instanceof Date) {
        formattedDate = business.search_date.toLocaleString();
      } else if (typeof business.search_date === 'string' && business.search_date) {
        formattedDate = new Date(business.search_date).toLocaleString();
      }
      
      // Add the row
      const row = worksheet.addRow({
        name: business.name || 'N/A',
        email: business.email || '',
        website: business.website || '',
        phone: business.phone || '',
        address: business.address || '',
        city: business.city || '',
        state: business.state || '',
        country: business.country || '',
        rating: business.rating || '',
        search_term: business.search_term || '',
        search_date: formattedDate || '',
        verified: business.verified ? 'Yes' : 'No',
        contacted: business.contacted ? 'Yes' : 'No'
      });
      
      // Make website and email clickable
      if (business.website) {
        const websiteCell = row.getCell('website');
        websiteCell.value = { 
          text: business.website,
          hyperlink: business.website.startsWith('http') ? business.website : `http://${business.website}`,
          tooltip: 'Click to visit website'
        };
        websiteCell.font = { color: { argb: '0563C1' }, underline: true };
      }
      
      if (business.email) {
        const emailCell = row.getCell('email');
        emailCell.value = { 
          text: business.email,
          hyperlink: `mailto:${business.email}`,
          tooltip: 'Click to send email'
        };
        emailCell.font = { color: { argb: '0563C1' }, underline: true };
      }
      
      // Set number format for rating
      if (business.rating) {
        const ratingCell = row.getCell('rating');
        ratingCell.numFmt = '0.0';
      }
      
      // Alternate row colors for better readability
      if (row.number % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'F5F5F5' }
        };
      }
    });
    
    // Add autofilter to the entire data range
    worksheet.autoFilter = {
      from: 'A1',
      to: `M${businesses.length + 1}`
    };
    
    // Add title above the table
    const titleRow = worksheet.insertRow(1, [`${title} - Total: ${businesses.length}`]);
    titleRow.font = { bold: true, size: 14 };
    titleRow.height = 24;
    worksheet.mergeCells(`A1:M1`);
    titleRow.alignment = { horizontal: 'center' };
    
    // Add borders to all cells
    for (let i = 1; i <= businesses.length + 2; i++) {
      const row = worksheet.getRow(i);
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border = {
          top: {style:'thin'},
          left: {style:'thin'},
          bottom: {style:'thin'},
          right: {style:'thin'}
        };
      });
    }

    // Add summary information
    const emailCount = businesses.filter(b => b.email).length;
    const websiteCount = businesses.filter(b => b.website).length;
    const emailPercentage = businesses.length > 0 ? Math.round((emailCount / businesses.length) * 100) : 0;
    const websitePercentage = businesses.length > 0 ? Math.round((websiteCount / businesses.length) * 100) : 0;
    
    const summaryRow = worksheet.addRow(['']);
    summaryRow.height = 20;
    
    const summaryHeaderRow = worksheet.addRow(['Summary Information']);
    summaryHeaderRow.font = { bold: true, size: 12 };
    worksheet.mergeCells(`A${summaryHeaderRow.number}:M${summaryHeaderRow.number}`);
    summaryHeaderRow.alignment = { horizontal: 'center' };
    summaryHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'DDEBF7' }
    };
    
    worksheet.addRow(['Total Businesses', businesses.length]);
    worksheet.addRow(['Businesses with Email', `${emailCount} (${emailPercentage}%)`]);
    worksheet.addRow(['Businesses with Website', `${websiteCount} (${websitePercentage}%)`]);
    
    const cities = [...new Set(businesses.map(b => b.city).filter(Boolean))];
    const states = [...new Set(businesses.map(b => b.state).filter(Boolean))];
    worksheet.addRow(['Total Cities', cities.length]);
    worksheet.addRow(['Total States', states.length]);
    
    // Save the workbook
    await workbook.xlsx.writeFile(filepath);
    return filepath;
  }

  async exportFilteredBusinesses(filter = {}) {
    try {
      // Build a dynamic query based on filters
      let queryConditions = [];
      let params = [];
      let paramIndex = 1;
      
      // Handle different filter types
      if (filter.state) {
        queryConditions.push(`state = $${paramIndex++}`);
        params.push(filter.state);
      }
      
      if (filter.city) {
        queryConditions.push(`city = $${paramIndex++}`);
        params.push(filter.city);
      }
      
      if (filter.hasEmail !== undefined) {
        if (filter.hasEmail) {
          queryConditions.push(`email IS NOT NULL AND email != ''`);
        } else {
          queryConditions.push(`(email IS NULL OR email = '')`);
        }
      }
      
      if (filter.hasWebsite !== undefined) {
        if (filter.hasWebsite) {
          queryConditions.push(`website IS NOT NULL AND website != ''`);
        } else {
          queryConditions.push(`(website IS NULL OR website = '')`);
        }
      }
      
      if (filter.minRating) {
        queryConditions.push(`rating >= $${paramIndex++}`);
        params.push(parseFloat(filter.minRating));
      }
      
      if (filter.contacted !== undefined) {
        queryConditions.push(`contacted = $${paramIndex++}`);
        params.push(filter.contacted);
      }
      
      if (filter.verified !== undefined) {
        queryConditions.push(`verified = $${paramIndex++}`);
        params.push(filter.verified);
      }
      
      // Build the final query
      let query = 'SELECT * FROM business_listings';
      if (queryConditions.length > 0) {
        query += ' WHERE ' + queryConditions.join(' AND ');
      }
      query += ' ORDER BY state, city, name';
      
      // Get filtered businesses
      const businesses = await db.getMany(query, params);
      
      if (businesses.length === 0) {
        throw new Error('No businesses found with the specified filters');
      }
      
      // Create descriptive title and filename
      let titleParts = [];
      if (filter.state) titleParts.push(filter.state);
      if (filter.city) titleParts.push(filter.city);
      if (filter.hasEmail) titleParts.push('With Email');
      if (filter.hasWebsite) titleParts.push('With Website');
      
      const title = titleParts.length > 0 ? titleParts.join(' - ') : 'Filtered Businesses';
      const dateTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const filename = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_${dateTime}.xlsx`;
      const filepath = path.join(this.exportDirectory, filename);
      
      await this.createExcelFile(businesses, filepath, title);
      
      return {
        filename,
        filepath,
        count: businesses.length
      };
    } catch (error) {
      logger.error(`Error exporting filtered businesses: ${error.message}`);
      throw error;
    }
  }
}

// Create a singleton instance
const exportService = new ExportService();

// Export the service
module.exports = exportService;
