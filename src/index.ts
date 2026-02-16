import { start } from "./commands/start.js";
import { stop } from "./commands/stop.js";
import { reset } from "./commands/reset.js";
import { setup } from "./commands/setup.js";
import { project } from "./commands/project.js";
import { init } from "./commands/init.js";
import { newTask } from "./commands/new.js";
import { status } from "./commands/status.js";
import { jobs } from "./commands/jobs.js";
import { learn } from "./commands/learn.js";

const banner = `                                       
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

  murder — a group or flock of agents
`;

const command = process.argv[2];

if (!command || command === "help" || command === "--help") {
  console.log(banner);
  console.log("  Usage: murder <command>\n");
  console.log("  Commands:");
  console.log("    start        Start murder (database + web UI)");
  console.log("    setup        Configure an AI provider (API key + models)");
  console.log("    init         Initialize current project for agent-first development");
  console.log('    new "<prompt>"  Plan and decompose a task for agent execution');
  console.log("    learn        Build project knowledge through guided Q&A");
  console.log("    status       Show active and recent agent tasks");
  console.log("    jobs         List all scheduled jobs and recent runs");
  console.log("    stop         Stop the murder database");
  console.log("    reset        Factory reset — destroy all data and start fresh");
  console.log("    project      Link the current directory as a murder project");
  console.log("    help         Show this help message");
  console.log();
  process.exit(0);
}

if (command === "start") {
  await start(banner);
} else if (command === "setup") {
  await setup();
} else if (command === "init") {
  await init();
} else if (command === "new") {
  await newTask();
} else if (command === "learn") {
  await learn();
} else if (command === "status") {
  await status();
} else if (command === "stop") {
  stop();
} else if (command === "jobs") {
  await jobs();
} else if (command === "project") {
  await project();
} else if (command === "reset") {
  await reset(banner);
} else {
  console.error(`  Unknown command: ${command}`);
  console.error(`  Run "murder help" for available commands.`);
  process.exit(1);
}
