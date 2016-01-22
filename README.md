# PubSub with Local Proxy - Redis

This is an example (incomplete) of a PubSub implementation for a chat service
using Redis and proxying client connections. With 3 c4.8xlarge instances and single
c4.4xlarge instance for redis, tests using a similar implementation reached 
over 100k connected clients at 10k messages/sec with all clients subscribing to 
a single channel. 

This is achieved by having each instance proxy subscriptions to a single (or
small number) of redis connections, so that while each instance may have hundreds
or thousands of subscribers, a single subscriber to redis is shared amongst them.
This allows us to scale out subscribers while adding only a fraction of actual
redis subscribers and significantly reduces network traffic.

* Use Redis PubSub
* Have a small number of shared connections, which cuts down on the # of redis subscribers
* When a message is received for a subscribed channel, emit an event to all locally subscribed clients

For example, if 100 clients were subscribed to "room1", and each client had its 
own connection to Redis, a single published message would result in 100 
messages being delivered. This can be optimized by having a single connection
subscribe to "room1", and locally emitting an event to all 100 clients that
a message was received. It cuts down on network and redis traffic, with the 
tradeoff of increased node CPU usage (these messages have to be routed somewhere).

The main bottleneck here is the number of event emitter listeners and how many
messages are being published per second. Tweaking will need to happen on a per
use case basic, but in local benchmarks a single node is able to many 10s - 100k
clients on a singe process and a reasonable msg/s rate (~5k). This can be tweaked
and tradeoffs made to improve performance (e.g., fall back to polling for chat
messages if the publisher rate for a room is too high)

# Example Usage
See `test/pubsub__client.js` (a mocha test file) for an example of how to use it

The basic idea is to create a redis connection instance object (configuring shard
settings and other configuration options), and create PubClient client object 
(from lib/pubsub__client.js). Each client object has a `.subscribe` and `.publish`
method, which 
