import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { concat, filter, from, interval, map, merge, Subject } from 'rxjs';
import type { Observable } from 'rxjs';

import type {
  OperationalStreamEvent,
  OperationalEventType,
} from '../domain/operational-events.js';

export type PublishEventInput = Omit<
  OperationalStreamEvent,
  'id' | 'timestamp'
> &
  Partial<Pick<OperationalStreamEvent, 'id' | 'timestamp'>>;

@Injectable()
export class OperationalEventBus {
  private readonly subject = new Subject<OperationalStreamEvent>();
  private readonly events: OperationalStreamEvent[] = [];

  publish(input: PublishEventInput): OperationalStreamEvent {
    const event: OperationalStreamEvent = {
      ...input,
      id: input.id ?? randomUUID(),
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
    this.events.push(event);
    if (this.events.length > 1000) this.events.shift();
    this.subject.next(event);
    return event;
  }

  stream(lastEventId?: string): Observable<OperationalStreamEvent> {
    const replay = this.replay(lastEventId).filter(
      (event) => event.audienceJourneyId == null,
    );
    const heartbeat = interval(15_000).pipe(map(() => this.heartbeat()));
    return concat(
      from(replay),
      merge(
        this.subject.pipe(filter((event) => event.audienceJourneyId == null)),
        heartbeat,
      ),
    );
  }

  streamJourney(
    journeyId: string,
    ownerRef: string,
    lastEventId?: string,
  ): Observable<OperationalStreamEvent> {
    const matches = (event: OperationalStreamEvent) =>
      event.audienceJourneyId === journeyId &&
      event.audienceOwnerRef === ownerRef;
    const heartbeat = interval(15_000).pipe(map(() => this.heartbeat()));
    return concat(
      from(this.replay(lastEventId).filter(matches)),
      merge(this.subject.pipe(filter(matches)), heartbeat),
    );
  }

  stateChanges(): Observable<OperationalStreamEvent> {
    return this.subject.pipe(
      filter((event) => event.type === 'operational.state.changed'),
    );
  }

  snapshot(type?: OperationalEventType): readonly OperationalStreamEvent[] {
    return type === undefined
      ? this.events.filter((event) => event.audienceJourneyId == null)
      : this.events.filter((event) => event.type === type);
  }

  private replay(lastEventId?: string): readonly OperationalStreamEvent[] {
    const index = lastEventId
      ? this.events.findIndex((event) => event.id === lastEventId)
      : -1;
    return index >= 0 ? this.events.slice(index + 1) : [];
  }

  private heartbeat(): OperationalStreamEvent {
    return {
      id: randomUUID(),
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
      entityId: null,
      incidentId: null,
      observationId: null,
      evidenceType: null,
      operationalState: null,
      sourceId: null,
      audienceJourneyId: null,
      audienceOwnerRef: null,
      metadata: {},
    };
  }
}
