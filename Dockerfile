
# Use an official Node runtime as a parent image
FROM node:20-bullseye-slim

# Install system dependencies (curl, gzip for govc download)
# We use bullseye-slim for a balance of size and compatibility
RUN apt-get update && apt-get install -y curl gzip ca-certificates && rm -rf /var/lib/apt/lists/*

# Install govc
# Downloads latest stable release, unzips, and moves to /usr/local/bin
# RUN curl -L -o - "https://github.com/vmware/govmomi/releases/latest/download/govc_$(uname -s)_$(uname -m).tar.gz" | tar -C /usr/local/bin -xvzf - govc

# Verify govc installation
# RUN govc version

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the Vite frontend
RUN npm run build

# Expose the port the app runs on
EXPOSE 3001

# Start the server (which serves the built frontend)
CMD ["node", "server.js"]
