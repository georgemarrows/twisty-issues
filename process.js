const fs = require('fs')
const async = require('async')

// Convert issues/ and comments/ JSON files saved
// by extract.js into a format that can be used by index.html
// to display relationships between issues and pull requests.
// Written in callback / async style for variety.

// TODO
// - get cross-refs from comments
// - clean-up and comment the code
// - check some of the unlikely looking cross-ref numbers against
//   the source text and tighten up the parsing

function listIssues(errorcb, cb) {
  fs.readdir("issues", (err, files) => err ? errorcb(err) : cb(files))
}

function readIssue(fname, errorcb, cb) {
  fs.readFile("issues/" + fname, (err, contents) => err ? errorcb(err) : cb(contents))
}

function serial(val, ...fns) {
  if (fns.length === 0) return val
  const fn = fns[0]
  fn(
    val,
    e => {console.log(e); process.exit(1)}, // FIXME
    v => serial(v, fns.slice(1))
  )
}

function pareach(fn) {
  // Returns a function which accepts a collection and runs FN
  // in parallel over it.
  // Returned function is (coll, errorcb, cb) =>
  // FN is (val, errorcb, cb) => ...
  // Returns array of values
  // 
  return function pareachImpl(vals, errorcb, cb) {
    let hasErrored = false
    const results = []
    let resultsStillToCome = vals.length
    for (val of vals) {
      fn(
        val,
        e => { hasErrored = true
               if (!hasErrored) errorcb(e) 
             },
        v => { if (!hasErrored) { 
                 results.push(v)
                 resultsStillToCome -= 1
                 if (resultsStillToCome === 0) {
                   cb(results)
                 }
               } 
             }
      )
    }
  }
}

// pareach((val, errorcb, cb) => {console.log(val); cb(10 * val)})([1,2,3,4,5], () => {}, val => console.log(val))

function map2(fn) {
  return function map2impl(data, cb) {
    async.map(data, fn, cb)
  }
}

function parallel2(...fns) {
  return function parallel2impl(data, parcb) {
    async.parallel(
      fns.map(fn => (cb => fn(data, cb))), 
      parcb)
  }
}

function callbackify(fn) {
  return function callbackifyImpl(data, cb) {
    let err = null, res = null
    try {
      res = fn(data)
    } catch(error) {
      err = error
    }
    cb(err, res)
  }
}


function readComments(issueNo, finishedCb) {
  async.waterfall([

    cb => fs.readFile("comments/" + issueNo, 'utf8', cb),
    
    callbackify(commentsText => {            
      comments = JSON.parse(commentsText)
      res = []
      for (let c of comments) {
        // FIXME scan for refs in c
        // Cross-refs seem to appear here as full links https://github.../issues/ or /pull/
        // Not as #1234 
        res.push({source: issueNo,
                  target: ref })
      }
      res
    })

  ],
  
  finishedCb)
}

function readIssue(issueNo, finishedCb) {
  async.waterfall([

    cb => fs.readFile('issues/' + issueNo, 'utf8', cb),
    
    callbackify(issueText => {            
      let issue = JSON.parse(issueText)
      let unquoted = ''
      if (issue.body) {
        unquoted = issue.body.replace(/```([\n\r]|.)*?```/g, '')
      }
      refs = unquoted.match(/#\d\d+/g)
      if (refs) {
        refs = refs.map(ref => ({source: issueNo,
                                 target: ref.replace(/#/, '')
                               }))
      }

      node = {id: issueNo,
               state: issue.state,
               title: issue.title,
               body: issue.body}
      if (issue.pullRequest) {
        node.pull_request_html_url = issue.pullRequest.htmlUrl
      }
      return {
        node: node,
        links: refs
        // console.log(refs)
      } 
    })

  ],
  
  finishedCb)
}

function chase(node, nodesHash, linksHash, nodeGroup, inGroup) {
  console.error("Chasing ", node)
  if (node.nodeGroup != undefined) return
  node.nodeGroup = nodeGroup
  inGroup.push(node)
  for (linkid of (linksHash[node.id] || [])) {
    chase(nodesHash[linkid], nodesHash, linksHash, nodeGroup, inGroup)
  }
}

function process(data) {
  // data is an array of {node: node, links: [link]} objects
  // We want an object of {nodes: [node], links: [link]}
  const nodes = []
  const links = []
  for (obj of data) {
    nodes.push(obj.node)
    if (obj.links) {
      links.push(...obj.links)
    }    
  }

  // Add nodes for link targets that don't exist
  const nodesHash = new Map()
  for (node of nodes) {
    nodesHash[node.id] = node
  }
  for (link of links) {
    if (!nodesHash[link.target]) {
      node = {
        id: link.target,
        state: 'unknown'
      }
      nodesHash[node.id] = node
      nodes.push(node)
    }
  }

  // Add node groups
  // Make the linksHash have both edges of the
  // "ref'd by" relationship so that we can 
  // chase whole clusters and put then in the same
  // nodeGroup
  const linksHash = new Map()
  for (link of links) {
    if (linksHash[link.source]) {
      linksHash[link.source].push(link.target)
    } else {
      linksHash[link.source] = [link.target]
    }
    if (linksHash[link.target]) {
      linksHash[link.target].push(link.source)
    } else {
      linksHash[link.target] = [link.source]
    }

  }

  let nodeGroup = 0
  for (let node of nodes) {
    if (node.nodeGroup != undefined) continue // already seen
    let inGroup = []
    chase(node, nodesHash, linksHash, nodeGroup, inGroup)
    
    let size = inGroup.length
    for (let n of inGroup) {
      n.groupSize = size
    }
    
    nodeGroup++
  }
  console.error(nodesHash)
  console.error(linksHash)

  return {nodes: nodes, links: links}
}

async.waterfall([
  cb => fs.readdir("issues", cb), // returns [issue filename, ...]
  map2(
    parallel2(
      readIssue
      // readComments
    )  // returns [issue refs, comment refs]
  ), // returns [[issue refs, comment refs], ...]
  callbackify(issuesAndComments => [].concat(...issuesAndComments)) ,
],
(err, data) => { 
  if (err) { 
    console.log(err) 
  } else { 
    console.log(JSON.stringify(process(data)))
  } } )


