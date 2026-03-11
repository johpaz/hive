# Hive UI

Dashboard and interaction interface for **Hive**, the personal AI agent runtime.

## Overview

Hive UI provides a modern, interactive environment to manage your AI agents, monitor real-time execution flows, and track long-running projects. Built with performance and user experience in mind, it leverages the AG-UI protocol for rich, visual agent-user interactions.

## Features

- **Agent Management**: View status, logs, and configuration for all your local and remote agents.
- **Real-time Canvas**: Interactive visualization of agent execution steps using the AG-UI protocol.
- **Project Tracking**: Dedicated views for multi-step tasks, including progress bars and step-by-step history.
- **MCP Integration**: Manage Model Context Protocol servers and their exposed tools.
- **Theme Support**: Seamless dark and light mode transitions.

## Tech Stack

- **Framework**: [Vite](https://vitejs.dev/) + [React](https://react.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **State Management**: [Zustand](https://docs.pmnd.rs/zustand/getting-started/introduction)
- **Data Fetching**: [React Query](https://tanstack.com/query/latest)
- **Icons**: [Lucide React](https://lucide.dev/)

## Getting Started

### Prerequisites

- Node.js (v18+)
- Local instance of **Hive Core** running

### Installation

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

The UI will be available at `http://localhost:5173`. It connects to the Hive Gateway at `http://localhost:18790` by default.

## Deployment

To build the project for production:

```bash
npm run build
```

The output will be in the `dist/` directory, which can be served by the Hive Gateway or any static host.
