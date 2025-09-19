const express = require('express');
const cors = require('cors');
const airtableService = require('./airtableService');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const http = require('http');
const { Server } = require("socket.io");
const { getSecret, initializeSecrets } = require('./secrets');
const { RecaptchaEnterpriseServiceClient } = require('@google-cloud/recaptcha-enterprise');
const app = express();
const server = http.createServer(app);

// All these variables will be initialized later inside initializeApp
let io;
let bucket;
let frontendUrl;
let recaptchaClient;




const allowedOrigins = [
    'http://localhost:5173',          // local dev
    'https://waiverprojects.web.app' // deployed frontend
];

// Helper function to generate consistent filenames
const generateContentFileName = (tableName, recordId, fieldName) => {
    return `content-${tableName}-${recordId}-${fieldName}.json`;
};


async function initializeApp() {
    try {
        // Fetch all secrets and initialize services before starting the server
        await initializeSecrets();

        frontendUrl = await getSecret('FRONTEND_URL');
        const bucketName = await getSecret('GCS_BUCKET_NAME');
        const airtableApiKey = await getSecret('AIRTABLE_API_KEY');
        const airtableBaseId = await getSecret('AIRTABLE_BASE_ID');
        const recaptchaProjectId = await getSecret('GCP_PROJECT_ID');
        // Initialize Airtable service and get the axios instance
        airtableService.initializeAirtableService(airtableApiKey, airtableBaseId);

        // Initialize Socket.IO
        io = new Server(server, {
            cors: {
                origin: allowedOrigins,
                methods: ["GET", "POST", "PATCH"],
                credentials: true
            }
        });

        // Initialize GCS
        const storage = new Storage();
        bucket = storage.bucket(bucketName);

        recaptchaClient = new RecaptchaEnterpriseServiceClient();

        // All API routes and Socket.IO logic go here
        // The server will only be started after this section is fully defined.
        // CORS
        // Use the initialized `airtableApi` instance in your routes
        app.use(express.json({ limit: '50mb' }));

        const corsOptions = {
            origin: (origin, callback) => {
                if (allowedOrigins.includes(origin) || !origin) {
                    callback(null, true);
                } else {
                    callback(new Error('Not allowed by CORS'));
                }
            },
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
            allowedHeaders: ["Content-Type", "Authorization"],
            credentials: true,
        };

        app.use(cors(corsOptions));

        const multerStorage = multer.memoryStorage();
        const upload = multer({ storage: multerStorage });

        // ----- API ROUTES -----

        // GET all records from the main table
        app.get('/api/records', async (req, res) => {
            try {
                const records = await airtableService.getRecords();
                res.json(records);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch records' });
            }
        });



        // File upload route
        app.post('/api/upload/:tableName/:recordId/:fieldName', upload.single('file'), async (req, res) => {
            try {
                const { recordId, tableName, fieldName } = req.params;
                if (!req.file) {
                    return res.status(400).send('No file uploaded.');
                }

                const blob = bucket.file(Date.now() + '-' + req.file.originalname);
                const blobStream = blob.createWriteStream({
                    resumable: false,
                });

                blobStream.on('error', err => {
                    console.error('GCS stream error:', err);
                    res.status(500).json({ error: `GCS Upload Stream Error: ${err.message}` });
                });

                blobStream.on('finish', async () => {
                    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;

                    try {
                        const currentRecord = await airtableService.getRecord(tableName, recordId);
                        const existingAttachments = currentRecord.fields[fieldName] || [];

                        const newAttachment = {
                            url: publicUrl,
                            filename: req.file.originalname,
                        };

                        const updatedAttachments = [...existingAttachments, newAttachment];
                        const updatedFields = {
                            [fieldName]: updatedAttachments,
                        };

                        const updatedRecord = await airtableService.updateRecord(recordId, updatedFields, tableName);
                        res.status(200).json(updatedRecord.fields[fieldName]);

                    } catch (error) {
                        console.error("Error updating Airtable:", error);
                        res.status(500).json({ error: `Failed to update Airtable record: ${error.message}` });
                    }
                });

                blobStream.end(req.file.buffer);

            } catch (error) {
                console.error('File upload controller error:', error);
                res.status(500).json({ error: `Failed to upload file: ${error.message}` });
            }
        });

        // Replace file (overwrite existing attachments)
        app.post('/api/replace/:tableName/:recordId/:fieldName', upload.single('file'), async (req, res) => {
            try {
                const { recordId, tableName, fieldName } = req.params;
                if (!req.file) {
                    return res.status(400).send('No file uploaded.');
                }

                const blob = bucket.file(Date.now() + '-' + req.file.originalname);
                const blobStream = blob.createWriteStream({ resumable: false });

                blobStream.on('error', err => {
                    console.error('GCS stream error:', err);
                    res.status(500).json({ error: err.message });
                });

                blobStream.on('finish', async () => {
                    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;

                    try {
                        const newAttachment = { url: publicUrl, filename: req.file.originalname };
                        const updatedFields = { [fieldName]: [newAttachment] };

                        const updatedRecord = await airtableService.updateRecord(
                            recordId,
                            updatedFields,
                            tableName
                        );

                        res.status(200).json(updatedRecord.fields[fieldName]);
                    } catch (error) {
                        console.error('Error updating Airtable in replace:', error);
                        res.status(500).json({ error: error.message });
                    }
                });

                blobStream.end(req.file.buffer);
            } catch (error) {
                console.error('Replace controller error:', error);
                res.status(500).json({ error: error.message });
            }
        });


        // GET filtered records - MOVED UP
        app.get('/api/records/filter/:recordId/:tableName', async (req, res) => {
            try {
                const { recordId, tableName } = req.params;
                const records = await airtableService.getFilteredRecords(recordId, tableName);
                res.json(records);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch filtered records' });
            }
        });

        // GET all incomplete actions
        app.get('/api/actions/incomplete', async (req, res) => {
            try {
                const allActions = await airtableService.getAllRecordsFromTable('actions');
                const allProjects = await airtableService.getAllRecordsFromTable('projects');

                const projectsMap = allProjects.reduce((map, project) => {
                    map[project.id] = project.fields;
                    return map;
                }, {});

                const incompleteActions = allActions
                    .filter(action => !action.fields.completed && action.fields['Project ID'])
                    .map(action => {
                        const projectRecordId = action.fields['Project ID'][0];
                        const projectFields = projectsMap[projectRecordId];
                        return {
                            ...action,
                            fields: {
                                ...action.fields,
                                ProjectName: projectFields ? projectFields['Project Name'] : 'N/A',
                                ProjectCustomID: projectFields ? projectFields['Project ID'] : 'N/A',
                            }
                        };
                    });

                res.json(incompleteActions);
            } catch (error) {
                console.error('Error fetching incomplete actions:', error.message);
                res.status(500).json({ error: 'Failed to fetch incomplete actions' });
            }
        });

        // GET a single record from a specified table
        app.get('/api/records/:tableName/:recordId', async (req, res) => {
            try {
                const { tableName, recordId } = req.params;
                const record = await airtableService.getRecord(tableName, recordId);
                res.json(record);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch record' });
            }
        });

        // GET all incomplete tasks
        app.get('/api/tasks/incomplete/:email', async (req, res) => {
            try {
                const { email } = req.params;
                const tasks = await airtableService.getFilteredRecords(email, 'tasks');
                res.json(tasks);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch tasks' });
            }
        });

        // GET all collaborators
        app.get('/api/collaborators', async (req, res) => {
            try {
                const collaborators = await airtableService.getAllRecordsFromTable('collaborators');
                res.json(collaborators);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch collaborators' });
            }
        });

        // POST (create) new records
        app.post('/api/records', async (req, res) => {
            try {
                const { recordsToCreate, tableName } = req.body;
                const createdRecords = await airtableService.createRecords(recordsToCreate, tableName);
                res.status(201).json(createdRecords);
            } catch (error) {
                res.status(500).json({ error: 'Failed to create records' });
            }
        });


        // PATCH (update) multiple records
        app.patch('/api/records', async (req, res) => {
            try {
                const { recordsToUpdate, tableName } = req.body;
                const updatedRecords = await airtableService.updateMultipleRecords(recordsToUpdate, tableName);
                res.json(updatedRecords);
            } catch (error) {
                res.status(500).json({ error: 'Failed to update records' });
            }
        });

        // DELETE multiple records
        app.delete('/api/records/:tableName', async (req, res) => {
            try {
                const { tableName } = req.params;
                const { recordIds } = req.body;
                if (!recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
                    return res.status(400).json({ error: 'Record IDs must be a non-empty array.' });
                }
                const deletedRecords = await airtableService.deleteMultipleRecords(recordIds, tableName);
                res.json({ message: 'Records deleted successfully', deletedRecords });
            } catch (error) {
                res.status(500).json({ error: 'Failed to delete records' });
            }
        });

        // GET task board for a project
        app.get('/api/records/board/:projectId/:tableName', async (req, res) => {
            try {
                const { projectId, tableName } = req.params;
                const response = await airtableService.getFilteredRecords(projectId, tableName);
                const transformedData = airtableService.transformData(response);
                res.json(transformedData);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch board' });
            }
        });


        // GET project messages
        app.get('/api/messages/:projectId/project_messages', async (req, res) => {
            try {
                const { projectId } = req.params;
                const records = await airtableService.getFilteredRecords(projectId, 'project_messages');
                res.json(records);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch project messages' });
            }
        });


        // GET records by IDs
        app.post('/api/records/by-ids', async (req, res) => {
            try {
                const { recordIds, tableName } = req.body;
                if (!recordIds || !Array.isArray(recordIds)) {
                    return res.status(400).json({ error: 'recordIds must be an array.' });
                }
                const records = await airtableService.getRecordsByIds(recordIds, tableName);
                res.json(records);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch records by IDs' });
            }
        });

        // PATCH (update) a single record
        app.patch('/api/records/:tableName/:recordId', async (req, res) => {
            try {
                const { tableName, recordId } = req.params;
                const { fields } = req.body;
                const updatedRecord = await airtableService.updateRecord(recordId, fields, tableName);
                res.json(updatedRecord);
            } catch (error) {
                res.status(500).json({ error: 'Failed to update record' });
            }
        });

        // GET all records from a specified table
        app.get('/api/all/:tableName', async (req, res) => {
            try {
                const { tableName } = req.params;
                const records = await airtableService.getAllRecordsFromTable(tableName);
                res.json(records);
            } catch (error) {
                res.status(500).json({ error: `Failed to fetch records from ${tableName}` });
            }
        });

        // GET authenticate client
        app.get('/api/authenticate/:projectName/:projectId', async (req, res) => {
            try {
                const { projectName, projectId } = req.params;
                const authenticatedClient = await airtableService.authenticateClient(projectName, projectId);
                res.json(authenticatedClient);
            } catch (error) {
                res.status(500).json({ error: 'Failed to authenticate client' });
            }
        });

        // GET all info pages -> This is perfect. No changes needed.
        app.get('/api/info-pages', async (req, res) => {
            try {
                const infoPages = await airtableService.getAllRecordsFromTable('informational_pages');
                const formattedPages = infoPages.map(record => ({
                    id: record.id,
                    title: record.fields.pageTitle,
                    order: record.fields.order,
                    icon: record.fields.icon,
                }));
                formattedPages.sort((a, b) => a.order - b.order);
                res.json(formattedPages);
            } catch (error) {
                console.error('Failed to fetch info pages:', error);
                res.status(500).json({ error: 'Failed to fetch info pages' });
            }
        });

        // GET a single info page -> This is also perfect. No changes needed.
        app.get('/api/info-pages/:pageId', async (req, res) => {
            try {
                const { pageId } = req.params;
                const infoPage = await airtableService.getRecord('informational_pages', pageId);
                const formattedPage = {
                    id: infoPage.id,
                    title: infoPage.fields.pageTitle,
                    order: infoPage.fields.order,
                    content: infoPage.fields.pageContent,
                    icon: infoPage.fields.icon,
                };
                res.json(formattedPage);
            } catch (error) {
                console.error(`Failed to fetch info page ${req.params.pageId}:`, error);
                res.status(500).json({ error: 'Failed to fetch info page' });
            }
        });

        // POST (create) a new info page -> CORRECTED
        app.post('/api/info-pages', async (req, res) => {
            try {
                const { title, icon } = req.body;

                if (!title || !title.trim()) {
                    return res.status(400).json({ error: 'Title is required' });
                }

                const allPages = await airtableService.getAllRecordsFromTable('informational_pages');
                const maxOrder = allPages.reduce((max, p) => Math.max(max, p.fields.order || 0), 0);

                const recordToCreate = {
                    fields: {
                        pageTitle: title.trim(),
                        pageContent: '',
                        order: maxOrder + 1,
                        icon: icon,
                    }
                };

                // --- FIX PART 1: Pass the record inside an array ---
                const airtableResponse = await airtableService.createRecords([recordToCreate], 'informational_pages');

                // --- FIX PART 2: Unwrap the response from your service ---
                // Your service returns { records: [...] }, so we need to get the first item from that array.
                const createdRecord = airtableResponse.records[0];

                // --- FIX PART 3: Flatten the object for the frontend ---
                const formattedResponse = {
                    id: createdRecord.id,
                    title: createdRecord.fields.pageTitle,
                    order: createdRecord.fields.order,
                    icon: createdRecord.fields.icon,
                };

                res.status(201).json(formattedResponse);

            } catch (error) {
                console.error('Failed to create info page:', error);
                res.status(500).json({ error: 'Failed to create info page' });
            }
        });

        // UPDATE your existing PATCH endpoint to include attachment handling:
        app.patch('/api/info-pages/:pageId', async (req, res) => {
            const { pageId } = req.params;
            console.log(`[PATCH /api/info-pages/${pageId}] - Request received.`);

            try {
                console.log('Request Body:', req.body);

                const { title, content, icon } = req.body;

                const fieldsToUpdate = {};

                // Handle title update (still stored directly)
                if (title !== undefined) {
                    fieldsToUpdate.pageTitle = title;
                }

                if (icon !== undefined) {
                    fieldsToUpdate.icon = icon;
                }

                // Handle content update (now via attachment) - this is separate from the pageAttachments field
                if (content !== undefined) {
                    // Save content as attachment instead of direct field update
                    const fileName = generateContentFileName('informational_pages', pageId, 'pageContent');

                    const file = bucket.file(fileName);

                    await file.save(content, {
                        metadata: {
                            contentType: 'application/json',
                            metadata: {
                                recordId: pageId,
                                tableName: 'informational_pages',
                                fieldName: 'pageContent',
                                updatedAt: new Date().toISOString()
                            }
                        }
                    });

                    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

                    // Airtable expects attachments in a specific format
                    const contentAttachment = {
                        url: publicUrl,
                        filename: fileName,
                    };

                    // Store the content attachment in the pageContent field (which is now an attachment field)
                    fieldsToUpdate.pageContent = [contentAttachment];
                }

                console.log('Fields to Update:', fieldsToUpdate);

                if (Object.keys(fieldsToUpdate).length === 0) {
                    console.log('Update failed: No valid fields provided.');
                    return res.status(400).json({ error: 'No valid fields to update were provided.' });
                }

                console.log('Payload for Airtable:', JSON.stringify(fieldsToUpdate, null, 2));

                const updatedRecord = await airtableService.updateRecord(pageId, fieldsToUpdate, 'informational_pages');

                console.log('Update successful.');
                res.json(updatedRecord);

            } catch (error) {
                console.error(`[PATCH /api/info-pages/${pageId}] - !! ERROR:`, error);
                res.status(500).json({ error: 'Failed to update info page' });
            }
        });

        // DELETE an info page
        app.delete('/api/info-pages/:pageId', async (req, res) => {
            try {
                const { pageId } = req.params;
                const deletedRecord = await airtableService.deleteMultipleRecords([pageId], 'informational_pages');
                res.json(deletedRecord);
            } catch (error) {
                console.error(`Failed to delete info page ${req.params.pageId}:`, error);
                res.status(500).json({ error: 'Failed to delete info page' });
            }
        });

        // POST (create) a new image asset
        app.post('/api/upload-image', upload.single('file'), async (req, res) => {
            try {
                const { sourceTable, sourceRecordId } = req.body;
                const file = req.file;

                if (!file || !sourceTable || !sourceRecordId) {
                    return res.status(400).json({ error: 'File, sourceTable, and sourceRecordId are required.' });
                }

                // --- Step 1: Create a new, empty asset record in Airtable ---
                const assetRecord = {
                    fields: {
                        assetName: file.originalname,
                        sourceTable: sourceTable,
                        sourceRecordID: sourceRecordId,
                    }
                };
                const createResponse = await airtableService.createRecords([assetRecord], 'image_assets');
                const newAssetId = createResponse.records[0].id;

                // --- Step 2: Now, upload the file to GCS and attach it to the new record ---
                // This part reuses the exact same logic as your existing /api/upload endpoint.
                const blob = bucket.file(Date.now() + '-' + file.originalname);
                const blobStream = blob.createWriteStream({
                    resumable: false,
                });

                blobStream.on('error', err => {
                    console.error('GCS stream error during image asset upload:', err);
                    res.status(500).json({ error: `GCS Upload Stream Error: ${err.message}` });
                });

                blobStream.on('finish', async () => {
                    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;

                    try {
                        // Update the 'imageFile' field of the record we just created.
                        // Since this is a new record, there are no existing attachments to worry about.
                        const newAttachment = {
                            url: publicUrl,
                            filename: file.originalname,
                        };

                        await airtableService.updateRecord(
                            newAssetId,
                            { imageFile: [newAttachment] }, // The field name in your image_assets table
                            'image_assets'
                        );

                        // --- Step 3: Send the public URL back to the frontend ---
                        res.status(200).json({ url: publicUrl });

                    } catch (error) {
                        console.error("Error updating image_assets record in Airtable:", error);
                        res.status(500).json({ error: `Failed to update Airtable record: ${error.message}` });
                    }
                });

                blobStream.end(file.buffer);

            } catch (error) {
                console.error('Failed to process image upload:', error);
                res.status(500).json({ error: 'Failed to upload image' });
            }
        });

        // ===================================
        // ATTACHMENT-BASED CONTENT STORAGE ENDPOINTS
        // ===================================

        // SAVE CONTENT AS ATTACHMENT
        app.post('/api/save-content-attachment', async (req, res) => {
            try {
                const { recordId, tableName, fieldName, content } = req.body;

                // Validation
                if (!recordId || !tableName || !fieldName || !content) {
                    return res.status(400).json({
                        error: 'Missing required fields: recordId, tableName, fieldName, content'
                    });
                }

                console.log(`Saving content attachment for ${tableName}.${fieldName}, record: ${recordId}`);

                // Generate consistent filename (will overwrite existing file)
                const fileName = generateContentFileName(tableName, recordId, fieldName);

                // Upload JSON content to Google Cloud Storage
                const file = bucket.file(fileName);

                await file.save(JSON.stringify(content), {
                    metadata: {
                        contentType: 'application/json',
                        metadata: {
                            recordId: recordId,
                            tableName: tableName,
                            fieldName: fieldName,
                            uploadedAt: new Date().toISOString()
                        }
                    }
                });

                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

                // FIX: Use the correct Airtable attachment format (same as your other upload endpoints)
                const attachment = {
                    url: publicUrl,
                    filename: fileName,
                    // Remove the 'type' field - Airtable doesn't expect it in this format
                };

                const updatePayload = {};
                updatePayload[fieldName] = [attachment];

                console.log('About to update Airtable record:', recordId);
                console.log('Update payload:', JSON.stringify(updatePayload, null, 2));

                await airtableService.updateRecord(recordId, updatePayload, tableName);

                console.log(`Successfully saved content attachment: ${publicUrl}`);
                res.json({
                    success: true,
                    url: publicUrl,
                    filename: fileName
                });

            } catch (error) {
                console.error('Error saving content attachment:', error);
                res.status(500).json({
                    error: 'Failed to save content attachment',
                    details: error.message
                });
            }
        });

        // GET CONTENT FROM ATTACHMENT
        app.get('/api/get-content-attachment/:tableName/:recordId/:fieldName', async (req, res) => {
            try {
                const { tableName, recordId, fieldName } = req.params;

                console.log(`Fetching content attachment for ${tableName}.${fieldName}, record: ${recordId}`);

                // Get record from Airtable
                const record = await airtableService.getRecord(tableName, recordId);
                const attachments = record.fields[fieldName];

                if (!attachments || attachments.length === 0) {
                    console.log(`No attachment found for ${tableName}.${fieldName}, record: ${recordId}`);
                    return res.json({ content: null });
                }

                // Get the first (and should be only) attachment
                const attachment = attachments[0];

                // Fetch JSON content from the attachment URL
                const response = await fetch(attachment.url);

                if (!response.ok) {
                    throw new Error(`Failed to fetch attachment: ${response.status} ${response.statusText}`);
                }

                const content = await response.text();

                console.log(`Successfully fetched content attachment for ${tableName}.${fieldName}`);
                res.json({
                    content: content,
                    filename: attachment.filename,
                    url: attachment.url
                });

            } catch (error) {
                console.error('Error fetching content attachment:', error);
                res.status(500).json({
                    error: 'Failed to fetch content attachment',
                    details: error.message
                });
            }
        });

        // This is the endpoint your frontend will send the form data to.
        app.post('/api/check-recaptcha', async (req, res) => {
            try {
                const { recaptchaKey, token, recaptchaAction } = req.body;

                if (!token || !recaptchaKey || !recaptchaAction) {
                    return res.status(400).json({ error: 'Recaptcha token, key, and action are required.' });
                }

                // NOTE: Ensure 'GCP_PROJECT_ID' is set in your secrets.

                if (!recaptchaProjectId) {
                    console.error('GCP_PROJECT_ID secret is not set.');
                    return res.status(500).json({ error: 'Server configuration error.' });
                }

                const projectPath = recaptchaClient.projectPath(recaptchaProjectId);

                const request = {
                    assessment: {
                        event: {
                            token: token,
                            siteKey: recaptchaKey,
                        },
                    },
                    parent: projectPath,
                };

                const [response] = await recaptchaClient.createAssessment(request);

                if (!response.tokenProperties.valid) {
                    console.error(`Recaptcha verification failed, invalid token: ${response.tokenProperties.invalidReason}`);
                    return res.status(400).json({ error: 'Invalid Recaptcha token.' });
                }

                if (response.tokenProperties.action !== recaptchaAction) {
                    console.error(`Recaptcha action mismatch. Expected: ${recaptchaAction}, Got: ${response.tokenProperties.action}`);
                    return res.status(400).json({ error: 'Recaptcha action mismatch.' });
                }

                if (response.riskAnalysis.score < 0.5) {
                    console.error(`Recaptcha check failed: low score (${response.riskAnalysis.score}).`);
                    return res.status(403).json({ error: 'Recaptcha verification failed. Your request was considered suspicious.' });
                }

                console.log(`Recaptcha assessment passed with score: ${response.riskAnalysis.score}`);

                // --- Recaptcha is valid, now process the form data ---
                res.status(200).json({ success: true, message: 'Form submitted successfully.' });

            } catch (error) {
                console.error('Error in /api/check-recaptcha:', error);
                res.status(500).json({ error: 'An unexpected error occurred during recaptcha check.' });
            }
        });

        // POST (create) a new intro submission
        app.post('/api/submit-intro-form', async (req, res) => {
            const { formData } = req.body;
            console.log('Form data:', formData);
            try {
                const formDate = new Date(`${formData.meetingDate}`)
                console.log('Form date:', formDate);
                const formattedDate =
                    formDate.getFullYear() +
                    "-" +
                    String(formDate.getMonth() + 1).padStart(2, "0") +
                    "-" +
                    String(formDate.getDate()).padStart(2, "0") +
                    "T" +
                    String(formDate.getHours()).padStart(2, "0") +
                    ":" +
                    String(formDate.getMinutes()).padStart(2, "0") +
                    ":" +
                    String(formDate.getSeconds()).padStart(2, "0");

                console.log('Formatted date:', formattedDate);
                const recordToCreate = {
                    fields: {
                        'PROGRAM/SERVICE NAME': formData.programService,
                        'Email': formData.yourEmail,
                        'STATE': formData.stateOfProgram,
                        'TYPE OF HELP ARE YOU LOOKING FOR': formData.typeOfHelp,
                        'PROGRAM OR SERVICES WILL YOUR AGENCY OFFER': formData.agencyServices,
                        'PLAN TO SERVE POPULATION': formData.populationToServe,
                        'Agency Name (Registered Or Proposed)': formData.agencyName,
                        'Agency Registration': (formData.agencyStatus === 'registered') ? true : false,
                        'Information': formData.agencyPlans,
                        'SCENARIOS': formData.scenario,
                        'FIRST & LAST NAME': formData.fullName,
                        'PHONE #': formData.phone,
                        'Initial Google Meet/Zoom Timing': formattedDate,
                        'Time Zone': formData.meetingTimePreference,
                        'Start time': formData.howSoon,
                        'consentName': formData.consentName,
                    }
                }
                const airtableResponse = await airtableService.createRecords([recordToCreate], 'intro_submissions');
                const createdRecord = airtableResponse.records[0];
                console.log('Intro form submitted successfully:', createdRecord);
                res.status(201).json(createdRecord);
            }
            catch (error) {
                console.error('Error in /api/submit-intro-form:', error);
                res.status(500).json({ error: 'An unexpected error occurred during intro form submission.' });
            }
        });


        // HYBRID CONTENT GETTER (ATTACHMENT + FALLBACK)
        app.get('/api/get-content-hybrid/:tableName/:recordId/:fieldName', async (req, res) => {
            try {
                const { tableName, recordId, fieldName } = req.params;

                console.log(`Fetching hybrid content for ${tableName}.${fieldName}, record: ${recordId}`);

                // Get record from Airtable
                const record = await airtableService.getRecord(tableName, recordId);

                // Try attachment first
                const attachments = record.fields[fieldName];

                if (attachments && attachments.length > 0) {
                    try {
                        const attachment = attachments[0];
                        const response = await fetch(attachment.url);

                        if (response.ok) {
                            const content = await response.text();
                            console.log(`Found attachment content for ${tableName}.${fieldName}`);
                            return res.json({
                                content: content,
                                source: 'attachment',
                                filename: attachment.filename
                            });
                        }
                    } catch (attachmentError) {
                        console.warn(`Attachment fetch failed for ${tableName}.${fieldName}:`, attachmentError.message);
                    }
                }

                // Fallback to old field names for existing data
                let fallbackFieldName;
                switch (fieldName) {
                    case 'Notes':
                        fallbackFieldName = 'Notes';
                        break;
                    case 'description':
                        fallbackFieldName = 'description';
                        break;
                    case 'pageContent':
                        fallbackFieldName = 'pageContent';
                        break;
                    default:
                        fallbackFieldName = fieldName;
                }

                const fallbackContent = record.fields[fallbackFieldName];

                if (fallbackContent) {
                    console.log(`Found fallback content for ${tableName}.${fallbackFieldName}`);
                    return res.json({
                        content: fallbackContent,
                        source: 'fallback'
                    });
                }

                console.log(`No content found for ${tableName}.${fieldName}, record: ${recordId}`);
                res.json({ content: null, source: 'none' });

            } catch (error) {
                console.error('Error fetching hybrid content:', error);
                res.status(500).json({
                    error: 'Failed to fetch hybrid content',
                    details: error.message
                });
            }
        });

        // ----- Socket.IO Connection -----
        io.on('connection', (socket) => {
            console.log('a user connected');

            socket.on('joinTaskRoom', (taskId) => {
                socket.join(taskId);
                console.log(`User joined room: ${taskId}`);
            });

            socket.on('leaveTaskRoom', (taskId) => {
                socket.leave(taskId);
                console.log(`User left room: ${taskId}`);
            });

            socket.on('sendMessage', async ({ taskId, message, sender }) => {
                try {
                    let taskRecordId = taskId;
                    if (!taskId.startsWith('rec')) {
                        taskRecordId = await airtableService.getTaskRecordIdByDisplayId(taskId);
                        if (!taskRecordId) {
                            throw new Error(`Task with display ID ${taskId} not found.`);
                        }
                    }

                    const newMessage = {
                        fields: {
                            task_id: [taskRecordId],
                            message_text: message,
                            sender: sender,
                        }
                    };
                    const createdRecord = await airtableService.createRecords([newMessage], 'task_chat');

                    io.to(taskId).emit('receiveMessage', createdRecord.records[0]);
                } catch (error) {
                    console.error('Error sending message:', error);
                    socket.emit('sendMessageError', { error: 'Failed to send message' });
                }
            });

            socket.on('joinProjectRoom', (projectId) => {
                socket.join(projectId);
                console.log(`User joined project room: ${projectId}`);
            });

            socket.on('leaveProjectRoom', (projectId) => {
                socket.leave(projectId);
                console.log(`User left project room: ${projectId}`);
            });

            socket.on('sendProjectMessage', async ({ projectId, message, sender }) => {
                try {
                    const newMessage = {
                        fields: {
                            project_id: [projectId],
                            message_text: message,
                            sender: sender,
                        }
                    };
                    const createdRecord = await airtableService.createRecords([newMessage], 'project_messages');

                    io.to(projectId).emit('receiveProjectMessage', createdRecord.records[0]);
                } catch (error) {
                    console.error('Error sending project message:', error);
                    socket.emit('sendProjectMessageError', { error: 'Failed to send project message' });
                }
            });

            // ... existing socket event handlers ...

            socket.on('markMessagesAsRead', async ({ messageIds, tableName }) => {
                try {
                    if (!messageIds || messageIds.length === 0 || !tableName) return;

                    console.log(`Marking ${messageIds.length} messages as read in ${tableName}`);

                    const recordsToUpdate = messageIds.map(id => ({
                        id: id,
                        fields: {
                            is_read: true
                        }
                    }));

                    // You'll need a generic updateRecords function in your airtableService
                    // similar to createRecords. I'm assuming one exists or you can create it.
                    await airtableService.updateMultipleRecords(recordsToUpdate, tableName);

                    // Optional: you could broadcast an event back to the room to inform
                    // other clients that messages have been read, but for now we will
                    // handle this optimistically on the client that triggers the read.

                } catch (error) {
                    console.error('Error marking messages as read:', error);
                    socket.emit('markMessagesAsReadError', { error: 'Failed to mark messages as read' });
                }
            });

            // ... rest of your socket event handlers ...

            socket.on('disconnect', () => {
                console.log('user disconnected');
            });
        });


        // ----- END API ROUTES -----

        // Start the server only after everything is initialized
        const port = process.env.PORT || 8080;
        server.listen(port, () => {
            console.log(`Server is running on port: ${port}`);
        });

    } catch (error) {
        console.error('Failed to initialize application:', error);
        process.exit(1);
    }
}

// Call the function to start the entire process
initializeApp();