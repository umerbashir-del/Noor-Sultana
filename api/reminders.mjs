import {hostedActionHandler} from '../lib/hosted-actions.mjs';
import {reminderAction} from '../prototype/reminders.mjs';
export const POST=hostedActionHandler(reminderAction);
