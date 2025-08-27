const express = require('express');
const cors = require('cors');
const airtableService = require('./airtableService');
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const http = require('http');
const { Server } = require("socket.io");
const { getSecret, initializeSecrets } = require('./secrets');

const app = express();
const server = http.createServer(app);

// All these variables will be initialized later inside initializeApp
let io;
let bucket;
let frontendUrl;

const allowedOrigins = [
    'http://localhost:5173',          // local dev
    'https://waiverprojects.web.app' // deployed frontend
];


async function initializeApp() {
    try {
        // Fetch all secrets and initialize services before starting the server
        await initializeSecrets();

        frontendUrl = await getSecret('FRONTEND_URL');
        const bucketName = await getSecret('GCS_BUCKET_NAME');
        const airtableApiKey = await getSecret('AIRTABLE_API_KEY');
        const airtableBaseId = await getSecret('AIRTABLE_BASE_ID');

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
                    attachment: infoPage.fields.pageAttachments, // Make sure this Airtable field name is correct
                    content: infoPage.fields.pageContent,
                };
                res.json(formattedPage);
            } catch (error) {
                console.error(`Failed to fetch info page ${req.params.pageId}:`, error);
                res.status(500).json({ error: 'Failed to fetch info page' });
            }
        });

        // POST (create) a new info page -> MODIFIED
        app.post('/api/info-pages', async (req, res) => {
            try {
                const { title } = req.body; // Expect a simple { title: "..." } object
                console.log('Title:', title);
                if (!title) {
                    return res.status(400).json({ error: 'Title is required' });
                }

                // Find the highest current order to place the new page at the end
                const allPages = await airtableService.getAllRecordsFromTable('informational_pages');
                const maxOrder = allPages.reduce((max, p) => Math.max(max, p.fields.order || 0), 0);
                console.log('Max Order:', maxOrder);
                const recordToCreate = {
                    fields: {
                        pageTitle: title,
                        pageContent: '', // Start with empty content
                        order: maxOrder + 1,
                    }
                };

                const createdRecord = await airtableService.createRecords(recordToCreate, 'informational_pages');
                console.log('Created Record:', createdRecord);
                res.status(201).json(createdRecord); // Use 201 for resource creation

            } catch (error) {
                console.error('Failed to create info page:', error);
                res.status(500).json({ error: 'Failed to create info page' });
            }
        });

        // PATCH (update) an info page -> ENHANCED WITH DEBUGGING 
        app.patch('/api/info-pages/:pageId', async (req, res) => {
            const { pageId } = req.params;
            console.log(`[PATCH /api/info-pages/${pageId}] - Request received.`);

            try {
                console.log('Request Body:', req.body); // <-- LOG 1: What did the frontend send?

                const { title, content, attachment } = req.body;

                const fieldsToUpdate = {};
                if (title !== undefined) {
                    fieldsToUpdate.pageTitle = title;
                }
                if (content !== undefined) {
                    fieldsToUpdate.pageContent = content;
                }
                if (attachment !== undefined) {
                    fieldsToUpdate.pageAttachments = attachment;
                }

                console.log('Fields to Update:', fieldsToUpdate); // <-- LOG 2: What are we preparing to send?

                if (Object.keys(fieldsToUpdate).length === 0) {
                    console.log('Update failed: No valid fields provided.');
                    return res.status(400).json({ error: 'No valid fields to update were provided.' });
                }

                console.log('Payload for Airtable:', JSON.stringify(fieldsToUpdate, null, 2)); // <-- LOG 3: What is the final object for Airtable?

                const updatedRecord = await airtableService.updateRecord(pageId, fieldsToUpdate, 'informational_pages');

                console.log('Update successful.');
                res.json(updatedRecord);

            } catch (error) {
                console.error(`[PATCH /api/info-pages/${pageId}] - !! ERROR:`, error); // <-- LOG 4: Catch the specific server error
                res.status(500).json({ error: 'Failed to update info page' });
            }
        });

        // DELETE an info page -> This is fine. No changes needed.
        app.delete('/api/info-pages/:pageId', async (req, res) => {
            try {
                const { pageId } = req.params;
                const deletedRecord = await airtableService.deleteRecord(pageId, 'informational_pages');
                res.json(deletedRecord);
            } catch (error) {
                console.error(`Failed to delete info page ${req.params.pageId}:`, error);
                res.status(500).json({ error: 'Failed to delete info page' });
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