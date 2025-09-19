const { google } = require('googleapis');
const { getSecret } = require('./secrets');

let oauth2Client;
let calendar;

// This function initializes the connection to the Google Calendar API
async function initializeGoogleCalendar() {
    try {
        const clientId = await getSecret('GOOGLE_CLIENT_ID');
        const clientSecret = await getSecret('GOOGLE_CLIENT_SECRET');
        const refreshToken = await getSecret('GOOGLE_REFRESH_TOKEN');

        if (!clientId || !clientSecret || !refreshToken) {
            throw new Error('Missing Google Calendar API credentials in Secret Manager.');
        }

        oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({
            refresh_token: refreshToken
        });

        // Test the connection by getting a new access token
        await oauth2Client.getAccessToken();
        console.log('Successfully connected to Google Calendar API.');

        calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    } catch (error) {
        console.error('Error initializing Google Calendar service:', error.message);
        // We throw the error to prevent the app from starting in a bad state.
        throw error;
    }
}

// This function finds available time slots on the calendar
async function getAvailableSlots(start, end) {
    try {
        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: start,
                timeMax: end,
                items: [{ id: 'primary' }], // 'primary' refers to the main calendar of the authenticated user
            },
        });

        const busySlots = response.data.calendars.primary.busy;
        // This is a simplified example. A real implementation would involve more complex logic
        // to calculate the free slots based on the busy slots and working hours.
        // For now, we'll just return the times the calendar is busy.
        return busySlots;

    } catch (error) {
        console.error('Error fetching free/busy slots:', error.message);
        throw error;
    }
}

// This function creates a new event on the calendar
async function createEvent(eventDetails) {
    try {
        const response = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: eventDetails,
            sendNotifications: true, // This will send email invitations to attendees
        });
        console.log('Event created successfully:', response.data.htmlLink);
        return response.data;
    } catch (error) {
        console.error('Error creating calendar event:', error.message);
        throw error;
    }
}

module.exports = {
    initializeGoogleCalendar,
    getAvailableSlots,
    createEvent,
};
