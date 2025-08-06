# Use the official Node.js 18 slim image as the base.
FROM node:18-slim

# Set the working directory inside the container.
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the container.
# This step is done first to leverage Docker's build cache.
COPY package*.json ./

# Install the application's production dependencies.
# The `npm install` command installs all dependencies.
# Cloud Run will automatically provide the environment variables defined in your .env file.
RUN npm install --omit=dev

# Copy the rest of the application code into the container.
# This includes all files in your directory, such as index.js and airtableService.js.
COPY . .

# Expose port 8080, which is the default port for Cloud Run.
EXPOSE 8080

# Define the command to run your application.
# We are using `node index.js` instead of `npm start`,
# because your start script uses `nodemon`, which is a development tool not needed for production.
CMD [ "node", "index.js" ]