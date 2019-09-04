
Dagoba = {} // namespace

//holds the graph

Dagoba.G = {}  // the prototype

Dagoba.graph = function (V, E) { // the factory
    var graph = Object.create(Dagoba.G)

    graph.edges = []      // fresh copies so they're not shared
    graph.vertices = []
    graph.vertexIndex = {}      // a lookup optimization

    graph.autoid = 1  // an auto-incrementing ID counter

    if (Array.isArray(V)) graph.addVertices(V)     // arrays only, because you wouldn't
    if (Array.isArray(E)) graph.addEdges(E)        //   call this with singular V and E

    return graph
}

Dagoba.G.addVertices = function (vs) { vs.forEach(this.addVertex.bind(this)) }
Dagoba.G.addEdges = function (es) { es.forEach(this.addEdge.bind(this)) }

Dagoba.G.addVertex = function (vertex) {         // accepts a vertex-like object
    if (!vertex._id)
        vertex._id = this.autoid++
    else if (this.findVertexById(vertex._id))
        return Dagoba.error('A vertex with that ID already exists')

    this.vertices.push(vertex)
    this.vertexIndex[vertex._id] = vertex         // a fancy index thing
    vertex._out = []; vertex._in = []             // placeholders for edge pointers
    return vertex._id
}

Dagoba.G.addEdge = function (edge) {             // accepts an edge-like object
    edge._in = this.findVertexById(edge._in)
    edge._out = this.findVertexById(edge._out)

    if (!(edge._in && edge._out))
        return Dagoba.error("That edge's " + (edge._in ? 'out' : 'in')
            + " vertex wasn't found")

    edge._out._out.push(edge)                     // edge's out vertex's out edges
    edge._in._in.push(edge)                       // vice versa

    this.edges.push(edge)
}

Dagoba.error = function (msg) {
    console.log(msg)
    return false
}

//Query part

Dagoba.Q = {}

Dagoba.query = function (graph) {                // factory
    var query = Object.create(Dagoba.Q)

    query.graph = graph                        // the graph itself
    query.state = []                           // state for each step
    query.program = []                           // list of steps to take
    query.gremlins = []                           // gremlins for each step

    return query
}

Dagoba.Q.add = function (pipetype, args) { // add a new step to the query
    var step = [pipetype, args]
    this.program.push(step)                 // step is a pair of pipetype and its args
    return this
}

Dagoba.G.v = function () {                       // query initializer: g.v() -> query
    var query = Dagoba.query(this)
    query.add('vertex', [].slice.call(arguments)) // add a step to our program
    return query
}

//Pipetypes

Dagoba.Pipetypes = {}

Dagoba.addPipetype = function (name, fun) {              // adds a chainable method
    Dagoba.Pipetypes[name] = fun
    Dagoba.Q[name] = function () {
        return this.add(name, [].slice.apply(arguments))
    }  // capture pipetype and args
}

Dagoba.getPipetype = function (name) {
    var pipetype = Dagoba.Pipetypes[name]                 // a pipetype is a function

    if (!pipetype)
        Dagoba.error('Unrecognized pipetype: ' + name)

    return pipetype || Dagoba.fauxPipetype
}

Dagoba.fauxPipetype = function (_, _, maybe_gremlin) {   // pass the result upstream
    return maybe_gremlin || 'pull'                        // or send a pull downstream
}

Dagoba.addPipetype('vertex', function (graph, args, gremlin, state) {
    if (!state.vertices)
        state.vertices = graph.findVertices(args)       // state initialization

    if (!state.vertices.length)                        // all done
        return 'done'

    var vertex = state.vertices.pop()                 // OPT: requires vertex cloning
    return Dagoba.makeGremlin(vertex, gremlin.state)  // gremlins from as/back queries
})

Dagoba.addPipetype('out', Dagoba.simpleTraversal('out'))
Dagoba.addPipetype('in', Dagoba.simpleTraversal('in'))

Dagoba.simpleTraversal = function (dir) {
    var find_method = dir == 'out' ? 'findOutEdges' : 'findInEdges'
    var edge_list = dir == 'out' ? '_in' : '_out'

    return function (graph, args, gremlin, state) {
        if (!gremlin && (!state.edges || !state.edges.length))     // query initialization
            return 'pull'

        if (!state.edges || !state.edges.length) {                 // state initialization
            state.gremlin = gremlin
            state.edges = graph[find_method](gremlin.vertex)        // get matching edges
                .filter(Dagoba.filterEdges(args[0]))
        }

        if (!state.edges.length)                                   // nothing more to do
            return 'pull'

        var vertex = state.edges.pop()[edge_list]                 // use up an edge
        return Dagoba.gotoVertex(state.gremlin, vertex)
    }
}

Dagoba.addPipetype('property', function (graph, args, gremlin, state) {
    if (!gremlin) return 'pull'                                  // query initialization
    gremlin.result = gremlin.vertex[args[0]]
    return gremlin.result == null ? false : gremlin             // false for bad props
})

Dagoba.addPipetype('unique', function (graph, args, gremlin, state) {
    if (!gremlin) return 'pull'                                  // query initialization
    if (state[gremlin.vertex._id]) return 'pull'                 // reject repeats
    state[gremlin.vertex._id] = true
    return gremlin
})

Dagoba.addPipetype('filter', function (graph, args, gremlin, state) {
    if (!gremlin) return 'pull'                                  // query initialization

    if (typeof args[0] == 'object')                              // filter by object
        return Dagoba.objectFilter(gremlin.vertex, args[0])
            ? gremlin : 'pull'

    if (typeof args[0] != 'function') {
        Dagoba.error('Filter is not a function: ' + args[0])
        return gremlin                                            // keep things moving
    }

    if (!args[0](gremlin.vertex, gremlin)) return 'pull'         // gremlin fails filter
    return gremlin
})

Dagoba.addPipetype('take', function (graph, args, gremlin, state) {
    state.taken = state.taken || 0                              // state initialization

    if (state.taken == args[0]) {
        state.taken = 0
        return 'done'                                             // all done
    }

    if (!gremlin) return 'pull'                                  // query initialization
    state.taken++
    return gremlin
})

Dagoba.addPipetype('as', function (graph, args, gremlin, state) {
    if (!gremlin) return 'pull'                                  // query initialization
    gremlin.state.as = gremlin.state.as || {}                   // init the 'as' state
    gremlin.state.as[args[0]] = gremlin.vertex                  // set label to vertex
    return gremlin
})

Dagoba.addPipetype('merge', function (graph, args, gremlin, state) {
    if (!state.vertices && !gremlin) return 'pull'               // query initialization

    if (!state.vertices || !state.vertices.length) {             // state initialization
        var obj = (gremlin.state || {}).as || {}
        state.vertices = args.map(function (id) { return obj[id] }).filter(Boolean)
    }

    if (!state.vertices.length) return 'pull'                    // done with this batch

    var vertex = state.vertices.pop()
    return Dagoba.makeGremlin(vertex, gremlin.state)
})


Dagoba.addPipetype('except', function (graph, args, gremlin, state) {
    if (!gremlin) return 'pull'                                  // query initialization
    if (gremlin.vertex == gremlin.state.as[args[0]]) return 'pull'
    return gremlin
})

Dagoba.addPipetype('back', function (graph, args, gremlin, state) {
    if (!gremlin) return 'pull'                                  // query initialization
    return Dagoba.gotoVertex(gremlin, gremlin.state.as[args[0]])
})

//Helpers
Dagoba.makeGremlin = function (vertex, state) {
    return { vertex: vertex, state: state || {} }
}

Dagoba.gotoVertex = function (gremlin, vertex) {               // clone the gremlin
    return Dagoba.makeGremlin(vertex, gremlin.state)
}

Dagoba.G.findVertices = function (args) {                      // vertex finder helper
    if (typeof args[0] == 'object')
        return this.searchVertices(args[0])
    else if (args.length == 0)
        return this.vertices.slice()                              // OPT: slice is costly
    else
        return this.findVerticesByIds(args)
}

Dagoba.G.findVerticesByIds = function (ids) {
    if (ids.length == 1) {
        var maybe_vertex = this.findVertexById(ids[0])            // maybe it's a vertex
        return maybe_vertex ? [maybe_vertex] : []                 // or maybe it isn't
    }

    return ids.map(this.findVertexById.bind(this)).filter(Boolean)
}

Dagoba.G.findVertexById = function (vertex_id) {
    return this.vertexIndex[vertex_id]
}




