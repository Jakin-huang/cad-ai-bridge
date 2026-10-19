export {projectRoot as root} from './src/config.mjs';
export {schemas} from './src/contracts.mjs';
export {hashFile} from './src/drawings.mjs';
import {createExecutor} from './src/runner.mjs';
export const execute=createExecutor();
