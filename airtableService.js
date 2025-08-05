const Airtable = require('airtable');
const axios = require('axios');

// Initialize Airtable
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const MAIN_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const COUNTER_TABLE_NAME = process.env.AIRTABLE_TABLE_COUNTER;
const COUNTER_RECORD_ID = process.env.AIRTABLE_TABLE_COUNTER_ID;
const ACTIONS_TABLE_NAME = process.env.AIRTABLE_ACTIONS_TABLE_ID;
const ACTIVITIES_TABLE_NAME = process.env.AIRTABLE_ACTIVITES_TABLE_ID;
const TASKS_TABLE_NAME = process.env.AIRTABLE_TABLE_TASKS_ID;
const COLLABORATORS_TABLE_NAME = process.env.AIRTABLE_TABLE_COLLABORATORS_ID;
const TASK_ATTACHMENTS_TABLE_NAME = process.env.AIRTABLE_TABLE_TASK_ATTACHMENTS_ID;
const TASK_CHECKLIST_TABLE_NAME = process.env.AIRTABLE_TABLE_TASK_CHECKLISTS_ID;
const TASK_FORMS_TABLE_NAME = process.env.AIRTABLE_TABLE_TASK_FORMS_ID;
const TASK_FORMS_FIELDS_TABLE_NAME = process.env.AIRTABLE_TABLE_TASK_FORMS_FIELDS_ID
const TASK_FORMS_SUBMISSIONS_TABLE_NAME = process.env.AIRTABLE_TABLE_TASK_FORMS_SUBMISSIONS_ID
const TASK_CHAT_TABLE_NAME = process.env.AIRTABLE_TABLE_TASK_CHAT_ID
// Re-usable axios instance for Airtable API
const airtableApi = axios.create({
    baseURL: `https://api.airtable.com/v0/${BASE_ID}`,
    headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
    }
});


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
        const response = await airtableApi.post(`/${table}`, { records: processedRecords });
        return response.data;
    } catch (error) {
        console.error('Airtable Service Error (createRecords):', error.response?.data || error.message);
        throw error;
    }
};

// Update multiple records
const updateMultipleRecords = async (recordsToUpdate, tableName) => {
    const table = getTableName(tableName);
    try {
        const response = await airtableApi.patch(`/${table}`, { records: recordsToUpdate });
        return response.data;
    } catch (error) {
        console.error('Airtable Service Error (updateMultipleRecords):', error.response?.data || error.message);
        throw error;
    }
};

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

const authenticateClient = async (projectName, projectID) => {
    const table = getTableName('mainTable');
    const formula = `AND(%7BProject+Name%7D+%3D+%22${projectName}%22%2C+%7BProject+ID%7D+%3D+%22${projectID}%22)`; 
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
}; 