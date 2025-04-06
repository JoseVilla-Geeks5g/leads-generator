import { NextResponse } from 'next/server';
import db from '@/services/database';
import logger from '@/services/logger';
import fs from 'fs';
import path from 'path';

// Default settings
const defaultSettings = {
    scraping: {
        maxConcurrentTasks: 4,
        maxResultsPerSearch: 200,
        browserTimeout: 30000,
        retryAttempts: 3,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    emailFinder: {
        maxConcurrentTasks: 4,
        searchDepth: 2,
        timeout: 30000,
        maxRetries: 2,
        checkWhois: false
    },
    batch: {
        waitBetweenTasks: 10000,
        maxResultsPerCity: 100,
        autoStartEmailFinder: false
    },
    export: {
        defaultFormat: 'xlsx',
        includeHeaders: true,
        dateFormat: 'YYYY-MM-DD HH:mm:ss'
    },
    system: {
        logLevel: 'info',
        cleanupOldExports: true,
        exportRetentionDays: 30
    }
};

// Get settings file path
function getSettingsPath() {
    return path.join(process.cwd(), 'settings.json');
}

// Load settings from file or create default
async function loadSettings() {
    try {
        const settingsPath = getSettingsPath();

        if (fs.existsSync(settingsPath)) {
            const settingsData = fs.readFileSync(settingsPath, 'utf8');
            return JSON.parse(settingsData);
        }

        // Create default settings file if it doesn't exist
        fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
        return defaultSettings;
    } catch (error) {
        logger.error(`Error loading settings: ${error.message}`);
        return defaultSettings;
    }
}

// Save settings to file
async function saveSettings(settings) {
    try {
        const settingsPath = getSettingsPath();
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        return true;
    } catch (error) {
        logger.error(`Error saving settings: ${error.message}`);
        return false;
    }
}

// Get settings
export async function GET() {
    try {
        const settings = await loadSettings();
        return NextResponse.json(settings);
    } catch (error) {
        logger.error(`Error getting settings: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to get settings', details: error.message },
            { status: 500 }
        );
    }
}

// Update settings
export async function POST(request) {
    try {
        const body = await request.json();

        // Validate settings
        if (!body || typeof body !== 'object') {
            return NextResponse.json(
                { error: 'Invalid settings format' },
                { status: 400 }
            );
        }

        // Load current settings
        const currentSettings = await loadSettings();

        // Update only provided settings, keeping the structure
        const updatedSettings = {
            ...currentSettings,
            ...body,
            // Ensure subsections are merged properly
            scraping: { ...currentSettings.scraping, ...(body.scraping || {}) },
            emailFinder: { ...currentSettings.emailFinder, ...(body.emailFinder || {}) },
            batch: { ...currentSettings.batch, ...(body.batch || {}) },
            export: { ...currentSettings.export, ...(body.export || {}) },
            system: { ...currentSettings.system, ...(body.system || {}) }
        };

        // Save updated settings
        const saved = await saveSettings(updatedSettings);

        if (!saved) {
            return NextResponse.json(
                { error: 'Failed to save settings' },
                { status: 500 }
            );
        }

        // Update log level if changed
        if (body.system?.logLevel) {
            logger.setLogLevel(body.system.logLevel);
        }

        return NextResponse.json({
            message: 'Settings updated successfully',
            settings: updatedSettings
        });
    } catch (error) {
        logger.error(`Error updating settings: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to update settings', details: error.message },
            { status: 500 }
        );
    }
}

// Reset settings to default
export async function DELETE() {
    try {
        await saveSettings(defaultSettings);

        return NextResponse.json({
            message: 'Settings reset to default',
            settings: defaultSettings
        });
    } catch (error) {
        logger.error(`Error resetting settings: ${error.message}`);
        return NextResponse.json(
            { error: 'Failed to reset settings', details: error.message },
            { status: 500 }
        );
    }
}
