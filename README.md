# murder

                        @@%#%@@        
                      @%%#@@%%%@@      
                    @@%%##%+@@*+-=%@   
                    @@%%%%%@@@@%%@@@   
                  @@@@%#%%%@@@@        
                @@@%#+=+#%%@@@@@       
              @@@%#**+==#%##%%%@@      
             @@@%%%%%*#%@%###*%@@      
           @@@@@@%@%%%%@%%%%%@@@       
          @@@@%%@@@@@@%%%%%%@@@        
        @@@@@@@@%%@@@%%%%@@@@@         
      @@@@@%%%@@@@%%%@@@@@@@@          
     @@@@@@@@@@@@@%%@@@@@@             
   @@@@%%%@@@@  @@@@ @@@               
     @@@@@       @@#%@@%@@@@           
                @@@@%#@%%@%@@          

**murder — a group or flock of agents**

`murder` is a local CLI tool that orchestrates a swarm of AI coding agents to accomplish tasks in your codebase. It learns over time -- the more it works in your project, the sharper it gets.

## Philosophy

Humans steer. Agents execute.

- Engineers define intent, structure, and constraints
- Agents write, test, review, and ship code
- The codebase itself is the system of record -- context lives in the repo, not in your head

## Tech Stack

| Component | Role |
|-----------|------|
| **Postgres 18** | Central brain -- tracks projects, tasks, and agent history |
| **pgvector** | Embedding storage for semantic memory and codebase knowledge |
| **pg_cron** | Scheduled maintenance, cleanup, and background jobs |
| **Docker** | Runs everything locally with zero host dependencies |

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (with Compose v2)
- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/)

### Install

```bash
git clone <repo-url> && cd murder
pnpm install
sudo ln -sf "$(pwd)/bin/murder" /usr/local/bin/murder
```

This clones the repo, installs dependencies, and adds `murder` to your PATH so you can use it from any project directory.

### Setup

```bash
murder setup
```

The setup wizard checks your environment, builds the database container, waits for it to be healthy, and verifies the extensions are installed.

### Usage

From any project directory on your machine:

```bash
murder setup    # Start the murder database
murder stop     # Stop the murder database
murder help     # Show available commands
```

### Connection Details

| | |
|---|---|
| **Host** | `localhost` |
| **Port** | `1313` |
| **User** | `murder` |
| **Password** | `murder` |
| **Database** | `murder` |
