import { appState } from './app/appState.js';
import { createHistory } from './app/history.js';
import { createProjectSettings } from './app/projectSettings.js';
import { startRenderLoop } from './app/renderLoop.js';
import { startup } from './app/startup.js';

startup({ appState, createHistory, createProjectSettings, startRenderLoop });
