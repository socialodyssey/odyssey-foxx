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

function parseBlacklist(str) {
  let blacklist = str;

  if(blacklist) {
    blacklist = blacklist.split(',').map(x => 'Entities/' + x)
  }

  return blacklist;
}

function getSubGraph(fromBk=1, toBk=24, opts={}) {
  const blacklist  = opts.blacklist  || [];
  const entityType = opts.entityType || 'all'; 

  const allEdges = db._query(
    aql`
FOR i IN ${Interactions}
    FILTER i.book >= ${fromBk} AND i.book <= ${toBk}
    RETURN i
`
  )._documents;

  const allEntities = db._query(
    aql`
FOR e IN ${Entities}
    RETURN e
`
  )._documents;
  const subCollection = db._create('tmpCollection');

  allEntities
    .filter((entity) => {
      if(entityType === 'mortal' && entity.type.lastIndexOf('PER') === -1) {
        return false;
      }

      if(entityType === 'god' && entity.type.lastIndexOf('GOD') === -1) {
        return false;
      }

      if(blacklist.length > 0 && blacklist.includes(entity._id)) {
        return false;
      }

      return true;
    })
    .forEach((entity) => {
      const entityClone = Object.assign({}, entity);
      entityClone._id = 'tmpCollection/' + entityClone._id.split('/')[1];
      delete entityClone._rev;

      subCollection.save(entityClone);
    })

  const subGraph = graphs._create('tmpGraph', [
    graphs._relation('tmpEdges', 'tmpCollection', 'tmpCollection')
  ]);

  allEdges
    .forEach((edge) => {
      const fromm = 'tmpCollection/' + edge._from.split('/')[1]
      const to    = 'tmpCollection/' + edge._to.split('/')[1]
      subGraph.tmpEdges.save(fromm, to, { book: edge.book })
    });

  return {
    drop: () => {
      graphs._drop('tmpGraph');
      db._drop('tmpEdges');
      subCollection.drop();
    },
    graph: subGraph
  }
}

router.get('/radius/:graph', function (req, res) {
  const graph     = loadGraph(res, req.pathParams.graph);
  const fromBk    = +req.queryParams.fromBk;
  const toBk      = +req.queryParams.toBk;
  const blacklist = parseBlacklist(req.queryParams.blacklist);
  const entityType = req.queryParams.entityType || 'all';

  const subGraph  = getSubGraph(fromBk, toBk, {
    blacklist:  blacklist,
    entityType: entityType
  });

  const radius = subGraph.graph._radius();
  subGraph.drop();

  res.json({
    radius: radius
  });
})
.pathParam('graph', joi.string().required(), 'The name of the graph')
.error('not found', 'Graph not found :(')

router.get('/diameter/:graph', function (req, res) {
  const fromBk     = +req.queryParams.fromBk;
  const toBk       = +req.queryParams.toBk;
  const blacklist  = parseBlacklist(req.queryParams.blacklist);
  const entityType = req.queryParams.entityType || 'all';

  const subGraph = getSubGraph(fromBk, toBk, {
    blacklist:  blacklist,
    entityType: entityType
  });

  const diameter = subGraph.graph._diameter();
  subGraph.drop();

  res.json({
    diameter: diameter
  })
})

router.get('/closeness/:graph', function (req, res) {
  const fromBk    = +req.queryParams.fromBk;
  const toBk      = +req.queryParams.toBk;
  const blacklist = parseBlacklist(req.queryParams.blacklist);
  const entityType = req.queryParams.entityType || 'all';

  const subGraph = getSubGraph(fromBk, toBk, {
    blacklist:  blacklist,
    entityType: entityType
  });

  const closenesses = subGraph.graph._closeness();
  subGraph.drop();

  const data = Object
    .keys(closenesses)
    .map((key) => {
      const closeness = closenesses[key];
      const entityId  = 'Entities/' + key.split('/')[1]
      const entity    = loadEntity(res, entityId);

      return {
        id:        entityId,
        name:      entity.name,
        closeness: closeness
      }
    })
    .sort(sortBy('closeness'))

  res.json(data);
});

router.get('/betweenness/:graph', function (req, res) {
  const fromBk    = +req.queryParams.fromBk;
  const toBk      = +req.queryParams.toBk;
  const blacklist = parseBlacklist(req.queryParams.blacklist);
  const entityType = req.queryParams.entityType || 'all';

  const subGraph = getSubGraph(fromBk, toBk, {
    blacklist:  blacklist,
    entityType: entityType
  });

  const betweennesses = subGraph.graph._betweenness();
  subGraph.drop();

  const data = Object
    .keys(betweennesses)
    .map((key) => {
      const betweenness = betweennesses[key];
      const entityId  = 'Entities/' + key.split('/')[1]
      const entity      = loadEntity(res, entityId);

      return {
        id:          entityId,
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
  const blacklist = parseBlacklist(req.queryParams.blacklist);
  const entityType = req.queryParams.entityType || 'all';

  const subGraph = getSubGraph(fromBk, toBk, {
    blacklist:  blacklist,
    entityType: entityType
  });

  const eccentricities = subGraph.graph._eccentricity();
  subGraph.drop();

  const data = Object
    .keys(eccentricities)
    .map((key) => {
      const eccentricity = eccentricities[key];
      const entityId  = 'Entities/' + key.split('/')[1]
      const entity      = loadEntity(res, entityId);

      return {
        id:          entityId,
        name:        entity.name,
        eccentricity: eccentricity
      }
    })
    .sort(sortBy('eccentricity'))

  res.json(data);
});

// XXX
router.get('/characterspeech', function (req, res) {
  const fromBk =  +req.queryParams.fromBk || 1;
  const toBk   =  +req.queryParams.toBk   || 12;

  const interactions = db._query(
    aql`
FOR i IN ${Interactions}
    FILTER i.book >= ${fromBk} AND i.book <= ${toBk}
    FILTER i.type == 'INR.VERBAL-NEAR' OR i.type == 'INR.VERBAL-FAR'
    FOR e IN ${Entities}
        FILTER e._id == i._from
        RETURN {
            id:     e._id,
            name:   e.name,
            speech: i.selection
        }
`
  )._documents;

  const entityMap = {};

  interactions
    .forEach((interaction) => {
      if(!entityMap[interaction.id]) {
        entityMap[interaction.id] = []
      }

      entityMap[interaction.id].push(interaction);
    })

  const data = Object
    .keys(entityMap)
    .map((entityId) => {
      const speechTotal = entityMap[entityId]
        .reduce((a, b) => a + (b.speech.to_line - b.speech.from_line), 0);

        return {
          id:     entityId,
          name:   entityMap[entityId][0].name,
          speech: speechTotal
        }
    })
    .sort((a, b) => b.speech - a.speech)

  res.json(data)
})

module.context.use(router);
