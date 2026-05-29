# Pelot Context

Pelot is a bike computer app for recording rides, showing live ride metrics, and helping a rider navigate while riding.

## Language

**Active Ride Navigation**:
The route guidance concept that covers choosing an origin, searching for a destination, keeping a planned bike route current before and during a ride, and rerouting while a ride is active.
_Avoid_: Route planner workflow, navigation service, routing screen logic

**Ride Recording Accumulator**:
The live ride recording concept that owns point ingestion, ride timing, manual pause intervals, auto-pause intervals, lap progress, calories, and the finish metrics snapshot for a recording ride.
_Avoid_: Metrics helper, recorder math, ride stats service
