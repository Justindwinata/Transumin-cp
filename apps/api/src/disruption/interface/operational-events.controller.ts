import { Controller, Headers, Inject, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { map } from 'rxjs';
import type { Observable } from 'rxjs';

import { OperationalEventBus } from '../application/operational-event-bus.js';

@Controller('operational-events')
export class OperationalEventsController {
  constructor(
    @Inject(OperationalEventBus)
    private readonly events: OperationalEventBus,
  ) {}

  @Sse('stream')
  stream(
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    return this.events.stream(lastEventId).pipe(
      map((event) => ({
        id: event.id,
        type: event.type,
        data: event,
        retry: 5000,
      })),
    );
  }
}
