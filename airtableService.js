const Airtable = require('airtable');
const axios = require('axios');
const { getSecret } = require('./secrets');

let AIRTABLE_API_KEY;
let BASE_ID;
let base;
let airtableApi;

function initializeAirtableService(apiKey, baseId) {
    try {
        AIRTABLE_API_KEY = apiKey;
        BASE_ID = baseId;

        base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(BASE_ID);
        airtableApi = axios.create({
            baseURL: `https://api.airtable.com/v0/${BASE_ID}`,
            headers: {
                Authorization: `Bearer ${AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log("Airtable service initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize Airtable service:", error);
        throw error;
    }
}


const MAIN_TABLE_NAME = "tblpIHBsPfZXu8IFs";
const COUNTER_TABLE_NAME = 'tblS3ijjC5fBGTuPR';
const COUNTER_RECORD_ID = 'recVvoLbScv02b54S';
const ACTIONS_TABLE_NAME = 'tblKQ8MMZMirJduk7';
const ACTIVITIES_TABLE_NAME = 'tblNQFudN16AwUKBM';
const TASKS_TABLE_NAME = 'tbl9D8m3mF2RVptEc'; 
const COLLABORATORS_TABLE_NAME = 'tblev0ek2lTzgxIMQ';
const TASK_ATTACHMENTS_TABLE_NAME = 'tblwPb1smWrdFtTfE';
const TASK_CHECKLIST_TABLE_NAME = 'tblbOAaUlFZvPzTTJ';
const TASK_FORMS_TABLE_NAME = 'tblLxZdNHFCq8ETVL';
const TASK_FORMS_FIELDS_TABLE_NAME = 'tbl91WJ2yjJX6ndAs'
const TASK_FORMS_SUBMISSIONS_TABLE_NAME = 'tbllxpBCIdShL5Mih'
const TASK_CHAT_TABLE_NAME = 'tblmByy6LcRAYyf0y'
const TASK_GROUPS_TABLE_NAME = 'tblCD3xEADjeAG3d4' 
const INFORMATIONAL_TABLE_NAME = 'tblM7936jKJeBdw36'
const IMAGE_ASSETS_TABLE_NAME = 'tblTP0vUb0aMMTpIr'
// Re-usable axios instance for Airtable API



const getTableName = (name) => {
    switch (name) {
        case 'counter':
            return COUNTER_TABLE_NAME;
        case 'actions':
            return ACTIONS_TABLE_NAME;
        case 'activities':
            return ACTIVITIES_TABLE_NAME;
        case 'tasks':
            return TASKS_TABLE_NAME;
        case 'collaborators':
            return COLLABORATORS_TABLE_NAME;
        case 'task_attachments':
            return TASK_ATTACHMENTS_TABLE_NAME;
        case 'task_checklists':
            return TASK_CHECKLIST_TABLE_NAME;
        case 'task_chat':
            return TASK_CHAT_TABLE_NAME;
        case 'task_forms':
            return TASK_FORMS_TABLE_NAME;
        case 'task_forms_fields':
            return TASK_FORMS_FIELDS_TABLE_NAME;
        case 'task_forms_submissions':
            return TASK_FORMS_SUBMISSIONS_TABLE_NAME;
        case 'task_groups':
            return TASK_GROUPS_TABLE_NAME;
        case 'informational_pages':
            return INFORMATIONAL_TABLE_NAME;
        case 'image_assets':
            return IMAGE_ASSETS_TABLE_NAME;
        default:
            return MAIN_TABLE_NAME;
    }
}

// Get all records from the main table
const getRecords = async () => {
    try {
        const records = await base(MAIN_TABLE_NAME).select().all();
        return records.map(record => ({ id: record.id, fields: record.fields }));
    } catch (error) {
        console.error('Airtable Service Error (getRecords):', error);
        throw error;
    }
};

// Get a single record
const getRecord = async (tableName, recordId) => {
    const table = getTableName(tableName);
    const id = tableName === 'counter' ? COUNTER_RECORD_ID : recordId;
    try {
        const record = await base(table).find(id);
        return { id: record.id, fields: record.fields };
    } catch (error) {
        console.error(`Airtable Service Error (getRecord on ${table}/${id}):`, error);
        throw error;
    }
};

// Get filtered records (e.g., actions for a project)
const getFilteredRecords = async (recordId, tableName) => {
    const table = getTableName(tableName);
    let formula;
    switch (tableName) {
        case 'actions':
            formula = `{Project ID} = "${recordId}"`;
            break;
        case 'tasks':
            // This endpoint is used for fetching tasks for a project, and for a user.
            // We differentiate based on whether the recordId looks like an email.
            if (recordId.includes('@')) {
                formula = `{assigned_to} = "${recordId}"`;
            } else {
                formula = `{Project ID (from Project ID)} = "${recordId}"`;
            }
            break;
        case 'task_groups':
            formula = `{Project ID (from projectID)} = "${recordId}"`;
            break;
        case 'task_attachments':
            // Filters attachments by the record ID of the parent task.
            formula = `{id (from task_id)} = "${recordId}"`;
            break;
        case 'task_checklists':
            formula = `{id (from task_id)} = "${recordId}"`;
            break;
        case 'task_forms_fields':
            formula = `FIND("${recordId}", ARRAYJOIN({task_form}))`;
            break;
        case 'task_forms_submissions':
            formula = `{id (from task_id)} = "${recordId}"`;
            break;
        case 'task_chat':
            formula = `{id (from task_id)} = "${recordId}"`; // task_id
            break;
        case "main_table":
            formula = `{Project ID} = "${recordId}"` // project id of record
            break;
        default:
            // Default logic for tables like 'activities' linked to a project.
            formula = `{Project ID (from Project ID)} = "${recordId}"`;
            break;
    }

    try {
        const url = `/${table}?filterByFormula=${encodeURIComponent(formula)}`;
        const response = await airtableApi.get(url);
        return response.data;
    } catch (error) {
        console.error('Airtable Service Error (getFilteredRecords):', error.response?.data || error.message);
        throw error;
    }
};


// Function to get task record ID from task display ID (e.g., "T-001")
const getTaskRecordIdByDisplayId = async (displayId) => {
    const table = getTableName('tasks');
    const formula = `{id} = "${displayId}"`;
    try {
        const url = `/${table}?filterByFormula=${encodeURIComponent(formula)}`;
        const response = await airtableApi.get(url);
        if (response.data.records.length > 0) {
            return response.data.records[0].id;
        }
        return null;
    } catch (error) {
        console.error('Airtable Service Error (getTaskRecordIdByDisplayId):', error.response?.data || error.message);
        throw error;
    }
};

// Create new records
const createRecords = async (recordsToCreate, tableName) => {
    const table = getTableName(tableName);
    const numericFields = ['Full Cost', 'Paid', 'Balance'];

    const processedRecords = table !== MAIN_TABLE_NAME ? recordsToCreate : recordsToCreate.map(record => {
        const cleanedFields = {};
        for (const field in record.fields) {
            let value = record.fields[field];
            if (numericFields.includes(field)) {
                cleanedFields[field] = value === '' ? 0 : Number(value);
            } else {
                cleanedFields[field] = value;
            }
        }
        return { fields: cleanedFields };
    });

    try {
        const allCreatedRecords = [];
        // Add the batching loop here
        for (let i = 0; i < processedRecords.length; i += 10) {
            const chunk = processedRecords.slice(i, i + 10);
            
            // Send only the small chunk to the API
            const response = await airtableApi.post(`/${table}`, { records: chunk });
            
            // Add the newly created records from the chunk to our final array
            allCreatedRecords.push(...response.data.records);
        }
        
        // Return all the records that were created across all batches
        return { records: allCreatedRecords };

    } catch (error) {
        console.error('Airtable Service Error (createRecords):', error.response?.data || error.message);
        throw error;
    }
};

// Update multiple records
const updateMultipleRecords = async (recordsToUpdate, tableName) => {
    const table = getTableName(tableName);

    try {
        const allUpdatedRecords = [];
        for (let i = 0; i < recordsToUpdate.length; i += 10) {
            const chunk = recordsToUpdate.slice(i, i + 10);
            const updatedChunk = await base(table).update(chunk);
            allUpdatedRecords.push(...updatedChunk);
        }
        return { records: allUpdatedRecords };

    } catch (error) {
        console.error('Airtable Service Error (updateMultipleRecords):', error.response?.data || error.message);
        throw error;
    }
};

// const updateMultipleRecords = async (recordsToUpdate, tableName) => {
//     try {
//         const allUpdatedRecords = [];

//         // Airtable's API has a hard limit of 10 records per update request.
//         // This loop breaks the incoming array from the frontend into "chunks" of 10.
//         for (let i = 0; i < recordsToUpdate.length; i += 10) {
//             // Get the next chunk of up to 10 records.
//             const chunk = recordsToUpdate.slice(i, i + 10);

//             // The 'base' variable should be your initialized Airtable base object.
//             // Send the update request for just this single chunk.
//             const updatedChunk = await base(tableName).update(chunk);

//             // Add the successfully updated records from this chunk to our results array.
//             allUpdatedRecords.push(...updatedChunk);
//         }

//         // Return all the updated records, matching the original expected format.
//         return { records: allUpdatedRecords };

//     } catch (error) {
//         // Log the detailed error on the server for debugging purposes.
//         console.error('Error in airtableService.updateMultipleRecords:', error);

//         // Throw an error that will be caught by your Express route handler,
//         // which will then send the 500 response.
//         throw new Error('Failed to update records');
//     }
// };

// Delete multiple records
const deleteMultipleRecords = async (recordIds, tableName) => {
    const table = getTableName(tableName);
    try {
        const deletedRecords = await base(table).destroy(recordIds);
        return deletedRecords;
    } catch (error) {
        console.error(`Airtable Service Error (deleteMultipleRecords on ${table}):`, error);
        throw error;
    }
};

// Update a single record
const updateRecord = async (recordId, fields, tableName) => {
    const table = getTableName(tableName);
    const id = tableName === 'counter' ? COUNTER_RECORD_ID : recordId;
    try {
        const record = await base(table).update(id, fields);
        return { id: record.id, fields: record.fields };
    } catch (error) {
        console.error(`Airtable Service Error (updateRecord on ${table}/${id}):`, error);
        throw error;
    }
}

const getAllRecordsFromTable = async (tableName) => {
    const table = getTableName(tableName);
    try {
        const records = await base(table).select().all();
        return records.map(record => ({ id: record.id, fields: record.fields }));
    } catch (error) {
        console.error(`Airtable Service Error (getAllRecordsFromTable on ${table}):`, error);
        throw error;
    }
};

const authenticateClient = async (projectName, projectId) => {
    const table = getTableName('mainTable');
    const formula = `AND(%7BProject+Name%7D+%3D+%22${projectName}%22%2C+%7BProject+ID%7D+%3D+%22${projectId}%22)`;
    try {
        const url = `/${table}?filterByFormula=${formula}`;
        const response = await airtableApi.get(url);
        return response.data;
    } catch (error) {
        console.error('Airtable Service Error (authenticateClient):', error.response?.data || error.message);
        throw error;
    }
};

const getRecordsByIds = async (recordIds, tableName) => {
    const table = getTableName(tableName);
    if (!recordIds || recordIds.length === 0) {
        return { records: [] };
    }
    const formula = `OR(${recordIds.map(id => `RECORD_ID() = '${id}'`).join(',')})`;
    try {
        const url = `/${table}?filterByFormula=${encodeURIComponent(formula)}`;
        const response = await airtableApi.get(url);
        return response.data;
    } catch (error) {
        console.error('Airtable Service Error (getRecordsByIds):', error.response?.data || error.message);
        throw error;
    }
};

const getNextAttachmentId = async () => {
    try {
        const counterRecord = await getRecord('counter');
        const currentId = counterRecord.fields.task_attachment_id_counter || 0;
        const nextId = currentId + 1;
        await updateRecord(null, { 'task_attachment_id_counter': nextId }, 'counter');
        return nextId;
    } catch (error) {
        console.error('Airtable Service Error (getNextAttachmentId):', error);
        throw error;
    }
};

function transformData(apiResponse) {
    const groupsMap = new Map(); // key = task_groups id, value = { group_name, group_order, tasks }
    const ungrouped = [];

    for (const record of apiResponse.records) {
        const task = { ...record.fields }; // copy task fields
        // remove grouping fields from the individual task
        delete task.task_groups;
        delete task.group_name;
        delete task.group_order;

        if (record.fields.task_groups && record.fields.task_groups.length > 0) {
            const groupId = record.fields.task_groups[0];
            const groupName = record.fields.group_name?.[0] || "Unnamed Group";
            const groupOrder = record.fields.group_order?.[0] ?? 0;

            if (!groupsMap.has(groupId)) {
                groupsMap.set(groupId, {
                    task_groups: groupId,
                    group_name: groupName,
                    group_order: groupOrder,
                    tasks: [],
                });
            }
            groupsMap.get(groupId).tasks.push(task);
        } else {
            ungrouped.push(task);
        }
    }

    // Reset order inside each group
    for (const group of groupsMap.values()) {
        group.tasks.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        group.tasks.forEach((t, idx) => {
            t.order = idx; // reset order
        });
    }

    // Reset order for ungrouped
    ungrouped.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    ungrouped.forEach((t, idx) => {
        t.order = idx;
    });

    // Convert groupsMap to array, sorted by group_order
    const groups = Array.from(groupsMap.values()).sort(
        (a, b) => a.group_order - b.group_order
    );

    return { groups, ungrouped };
}



module.exports = {
    getRecords,
    getRecord,
    getFilteredRecords,
    createRecords,
    updateMultipleRecords,
    deleteMultipleRecords,
    updateRecord,
    getAllRecordsFromTable,
    authenticateClient,
    getRecordsByIds,
    getNextAttachmentId,
    getTaskRecordIdByDisplayId,
    initializeAirtableService,
    airtableApi,
    transformData
}; 
