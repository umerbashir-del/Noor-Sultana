import {hostedActionHandler} from '../lib/hosted-actions.mjs';
import {crewAction} from '../prototype/crew.mjs';
export const POST=hostedActionHandler(crewAction);
