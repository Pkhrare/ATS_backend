# Backend Service

This repository contains the backend service for your application, built with Node.js and Express. It integrates with Airtable for data management, Google Cloud Storage for file uploads, and uses Socket.IO for real-time communication. The service is designed for automated deployment to Google Cloud Run via Cloud Build.

---

## ✨ Features

* **RESTful API**: Provides endpoints for managing records in Airtable (GET, POST, PATCH, DELETE).

* **File Uploads**: Supports uploading and replacing files to Google Cloud Storage, with attachment links stored in Airtable.

* **Real-time Communication**: Utilizes Socket.IO for real-time messaging within task-specific rooms.

* **Google Cloud Secret Manager Integration**: Securely retrieves API keys and other sensitive information at runtime.

* **Automated CI/CD**: Configured for continuous deployment to Google Cloud Run using Cloud Build upon Git pushes.

---

## 🚀 Technologies Used

* **Node.js**

* **Express.js**

* **Airtable API**

* **Google Cloud Storage (GCS)**

* **Google Cloud Secret Manager**

* **Socket.IO**

* **Multer** (for handling `multipart/form-data`)

* **axios** (for HTTP requests)

* **Google Cloud Run**

* **Google Cloud Build**

* **Docker**

---

## 🛠️ Local Development Setup

To run this project locally, follow these steps:

1.  **Clone the repository:**

    ```bash
    git clone [https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git](https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git)
    cd YOUR_REPO_NAME

    ```

2.  **Install dependencies:**

    ```bash
    npm install

    ```

3.  **Create a `.env` file:**
    For local development, you'll need a `.env` file in the root directory to store your environment variables, as you won't be using Google Cloud Secret Manager directly for local testing.

    ```dotenv
    PORT=3000
    FRONTEND_URL=http://localhost:5173 # Or your frontend's local URL
    AIRTABLE_API_KEY=YOUR_AIRTABLE_API_KEY
    AIRTABLE_BASE_ID=YOUR_AIRTABLE_BASE_ID
    GCS_BUCKET_NAME=YOUR_GCS_BUCKET_NAME
    # Add any other secrets your application needs, matching the names in secrets.js

    ```

    > **Note:** For production deployment on Cloud Run, these secrets will be fetched from Google Cloud Secret Manager.

4.  **Run the application:**

    ```bash
    npm start

    ```

    The server will start on the port specified in your `.env` file (defaulting to 3000).

---

## ☁️ Deployment to Google Cloud Run (CI/CD)

This project is set up for automated deployment to Google Cloud Run using Cloud Build.

### Prerequisites

* A Google Cloud Project.

* Google Cloud SDK installed and authenticated.

* Enabled APIs: Cloud Run, Artifact Registry, Cloud Build, Secret Manager.

* A Docker repository created in Artifact Registry (e.g., `my-repository` in `us-central1`).

### 1. Google Cloud Secret Manager Setup

Store your sensitive information in Secret Manager. Ensure your Cloud Run service account has the **"Secret Manager Secret Accessor"** role for each secret.

* **`AIRTABLE_API_KEY`**: Your Airtable API key.

* **`AIRTABLE_BASE_ID`**: Your Airtable Base ID.

* **`FRONTEND_URL`**: The URL of your frontend application (e.g., `https://your-frontend.web.app`).

* **`GCS_BUCKET_NAME`**: The name of your Google Cloud Storage bucket.

* **`PORT`**: (Optional) While Cloud Run provides `PORT=8080`, if you need to explicitly set it or fetch it for other reasons, define this secret. Otherwise, `process.env.PORT` will be used.

### 2. Update Configuration Files

Ensure the following files are correctly configured with your Google Cloud Project ID:

* **`secrets.js`**: Update `projects/[PROJECT-ID]/secrets/...` to use your actual Project ID (`tester-468120`).

* **`cloudbuild.yaml`**: Update `us-central1-docker.pkg.dev/[PROJECT_ID]/...` in both the build and deploy steps to use your actual Project ID (`tester-468120`).

### 3. Connect GitHub to Cloud Build

1.  Go to [Cloud Build Triggers](https://console.cloud.google.com/cloud-build/triggers) in the Google Cloud Console.

2.  Click **"Connect repository"**, select **"GitHub (Cloud Build GitHub App)"**, and follow the prompts to connect your repository.

### 4. Create a Cloud Build Trigger

1.  On the [Cloud Build Triggers](https://console.cloud.google.com/cloud-build/triggers) page, click **"Create trigger"**.

2.  **Name**: `github-push-to-cloud-run`

3.  **Event**: `Push to a branch`

4.  **Source**: Select your repository and the branch you want to deploy from (e.g., `main`).

5.  **Configuration**:

    * **Type**: `Cloud Build configuration file`

    * **Location**: `/cloudbuild.yaml` (assuming it's in the root of your repo)

6.  Click **"Create"**.

### 5. Grant Cloud Build Permissions

The Cloud Build service account needs permissions to deploy to Cloud Run.

1.  Go to the [IAM](https://console.cloud.google.com/iam-admin/iam) page in the Google Cloud Console.

2.  Find the Cloud Build service account (typically `[PROJECT_NUMBER]@cloudbuild.gserviceaccount.com`).

3.  Grant it the following roles:

    * **Cloud Run Admin**

    * **Service Account User**

### 6. Deploy!

Push your `Dockerfile`, `cloudbuild.yaml`, and all your application code to the configured GitHub branch. Cloud Build will automatically:

1.  Build your Docker image.

2.  Push it to Artifact Registry.

3.  Deploy a new revision of your `production-backend-service` to Cloud Run.

You can monitor the build progress in the [Cloud Build history](https://console.cloud.google.com/cloud-build/builds). Once deployed, find your service URL on the [Cloud Run page](https://console.cloud.google.com/run).

---

## 📚 API Endpoints

(Add detailed documentation for each of your API endpoints here, including method, path, request body, and response examples.)

**Example:**

### `GET /api/records`

* **Description**: Retrieves all records from the main table.

* **Method**: `GET`

* **URL**: `/api/records`

* **Response**: `200 OK` with a JSON array of records.

### `POST /api/upload/:tableName/:recordId/:fieldName`

* **Description**: Uploads a file to GCS and attaches it to an Airtable record.

* **Method**: `POST`

* **URL**: `/api/upload/:tableName/:recordId/:fieldName`

* **Request Body**: `multipart/form-data` with a file field named `file`.

* **Response**: `200 OK` with the updated attachment array.

---

## 💬 Socket.IO Events

(Document your Socket.IO events here, including event names, expected payloads, and emitted responses.)

**Example:**

### `joinTaskRoom`

* **Description**: A client joins a specific task's real-time communication room.

* **Emits**: `joinTaskRoom`

* **Payload**: `(taskId: string)`

### `sendMessage`

* **Description**: A client sends a message to a task room.

* **Emits**: `sendMessage`

* **Payload**: `({ taskId: string, message: string, sender: string })`

* **Receives (broadcast to room)**: `receiveMessage`

* **Payload**: `(messageRecord: object)`

---

## 🤝 Contributing

(Optional: Add guidelines for how others can contribute to your project.)

---

## 📄 License

This project is licensed under the ISC License.
