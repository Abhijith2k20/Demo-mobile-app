// Display helpers only. Rules and calculations live on the server.
import { format, parseISO } from 'date-fns';

export const todayIso = (): string => format(new Date(), 'yyyy-MM-dd');

export const shortDate = (iso: string): string => format(parseISO(iso), 'd MMM');
