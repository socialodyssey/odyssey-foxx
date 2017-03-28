'use strict';

const createRouter  = require('@arangodb/foxx/router');
const router        = createRouter();
const joi           = require('joi');
const db            = require('@arangodb').db;
const errors        = require('@arangodb').errors;
const Entities      = db._collection('Entities');
const Interactions  = db._collection('Interactions');
const DOC_NOT_FOUND = errors.ERROR_ARANGO_DOCUMENT_NOT_FOUND.code;
const aql           = require('@arangodb').aql;

const graphs = require('@arangodb/general-graph');

function sortBy(key) {
  return (a, b) => {
    return b[key] < a[key] ? -1 : 1;
  }
}

function loadGraph(res, name) {
  let graph;

  try {
    graph = graphs._graph(name);
  } catch (e) {
    res.throw('Graph not found');
  }

  return graph
}

function loadEntity(res, id) {
  let doc;
  
  try {
    doc = Entities.document(id);
  } catch (e) {
    if (!e.isArangoError || e.errorNum !== DOC_NOT_FOUND) {
      throw e;
    }
    res.throw(404, 'The entry does not exist', e);
  }

  return doc;
}

function getSubGraph(fromBk=1, toBk=24) {

  const allEdges = db._query(
    aql`
FOR i IN ${Interactions}
    FILTER i.book >= ${fromBk} AND i.book <= ${toBk}
    RETURN i
`
  )._documents;
  
  const subGraph = graphs._create('tmpGraph', [
    graphs._relation('tmpEdges', 'Entities', 'Entities')
  ]);
  
  allEdges
    .forEach((edge) => {
      subGraph.tmpEdges.save(edge._from, edge._to, { book: edge.book })
    })

  return {
    drop: () => {
      graphs._drop('tmpGraph');
      db._drop('tmpEdges');
    },
    graph: subGraph
  }
}

router.get('/radius/:graph', function (req, res) {
  const graph = loadGraph(res, req.pathParams.graph);
  const fromBk =  +req.queryParams.fromBk;
  const toBk   =  +req.queryParams.toBk;

  const subGraph = getSubGraph(fromBk, toBk);

  const radius = subGraph.graph._radius();
  subGraph.drop();

  res.json({
    radius: radius
  });
})
.pathParam('graph', joi.string().required(), 'The name of the graph')
.error('not found', 'Graph not found :(')

router.get('/diameter/:graph', function (req, res) {
  const fromBk =  +req.queryParams.fromBk;
  const toBk   =  +req.queryParams.toBk;

  const subGraph = getSubGraph(fromBk, toBk);

  const diameter = subGraph.graph._diameter();
  subGraph.drop();

  res.json({
    diameter: diameter
  })
})

router.get('/closeness/:graph', function (req, res) {
  const fromBk =  +req.queryParams.fromBk;
  const toBk   =  +req.queryParams.toBk;

  const subGraph = getSubGraph(fromBk, toBk);

  const closenesses = subGraph.graph._closeness();
  subGraph.drop();

  const data = Object
    .keys(closenesses)
    .map((key) => {
      const closeness = closenesses[key];
      const entity    = loadEntity(res, key);

      return {
        id:        key,
        name:      entity.name,
        closeness: closeness
      }
    })
    .sort(sortBy('closeness'))

  res.json(data);
});

router.get('/betweenness/:graph', function (req, res) {
  const fromBk =  +req.queryParams.fromBk;
  const toBk   =  +req.queryParams.toBk;

  const subGraph = getSubGraph(fromBk, toBk);

  const betweennesses = subGraph.graph._betweenness();
  subGraph.drop();

  const data = Object
    .keys(betweennesses)
    .map((key) => {
      const betweenness = betweennesses[key];
      const entity      = loadEntity(res, key);

      return {
        id:          key,
        name:        entity.name,
        betweenness: betweenness
      }
    })
    .sort(sortBy('betweenness'))

  res.json(data);
})

router.get('/eccentricity/:graph', function (req, res) {
  const fromBk =  +req.queryParams.fromBk;
  const toBk   =  +req.queryParams.toBk;

  const subGraph = getSubGraph(fromBk, toBk);

  const eccentricities = subGraph.graph._eccentricity();
  subGraph.drop();

  const data = Object
    .keys(eccentricities)
    .map((key) => {
      const eccentricity = eccentricities[key];
      const entity      = loadEntity(res, key);

      return {
        id:          key,
        name:        entity.name,
        eccentricity: eccentricity
      }
    })
    .sort(sortBy('eccentricity'))

  res.json(data);
});

module.context.use(router);
