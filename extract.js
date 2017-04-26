const http = require('http')
const Octokat = require('octokat')
const fs = require('mz/fs')

// HTTP request debugging
// store a reference to the original request function
// const originalRequest = http.request; 
// override the function
// http.request = function wrapMethodRequest(req) {
//   req.headers['Authorization'] = 'token ' + process.env.GITHUB_TOKEN
//   console.log(process.env.GITHUB_TOKEN);
//   // do something with the req here
//   // ...
//   // call the original 'request' function   
//   return originalRequest.apply(this, arguments);
// }

// Fetch issues and their comments as JSON and save in issues/ and comments/
// directory under cwd.
// Written using promises & async/await.

// TODO
// - track etags for comments

const owner_name = 'JuliaLang', 
      repo_name = 'julia'

const octo = new Octokat({
  token: process.env.GITHUB_TOKEN
})

const repo = octo.repos(owner_name, repo_name)


////// Generic utils

function timeout(ms) {
  return new Promise((resolve, reject) => setTimeout(resolve, ms))
}

async function concatWithDelay(promiseCreators, ms) {
  // A Promise to run a series of promises in turn with a delay of MS
  // milliseconds between them. The promises are given by a series
  // of *functions* in PROMISECREATORS, each of which returns a promise
  // when called. This delaying is necessary because a promise starts
  // running as soon as it is created.
  for (const promiseCreator of promiseCreators) {
    await timeout(ms)
    await promiseCreator()
  }
}

function delay(fn, ...args) {
  return () => fn(...args)
}


////// The application

const pageSize = 100

async function issues() {
  var res = await repo.issues.fetch({per_page: pageSize})
  return [res, res.nextPage]
}


async function saveCommentsForIssue(issue) {
  // A Promise to save all comments for ISSUE
  try {
    console.log("Saving comments for " + issue.number + " with comments " + issue.comments)

    let allComments = []

    let fetcher = octo.fromUrl(issue.commentsUrl).fetch({per_page: pageSize})
    for (;;) {
      res = await fetcher
      allComments = allComments.concat(res.items)
      if (!res.nextPage) break;
      fetcher = res.nextPage.fetch()
    }

    await fs.writeFile('comments/' + issue.number, JSON.stringify(allComments))
  } catch (error) {
    console.log("Failed to fetch/save comments for issue " + issue.number + "\nError: ", error )
  }
}


async function saveAllIssues(page) {
  // A Promise<void> which completes when a page of issues has been saved to disk
  const save = issue => fs.writeFile('issues/' + issue.number, JSON.stringify(issue))
  const allOutput = page.items.map(save)

  const pausedPromises = page.items.map(issue => delay(saveCommentsForIssue, issue))
  const allComments = concatWithDelay(pausedPromises, 500)
  allOutput.push(allComments)

  await Promise.all(allOutput)
}


async function test() {
  let [res, _] = await issues()
  i = 1
  for (;;) {
    console.log(">>> Page " + (i++) + " of issues")
    
    await saveAllIssues(res)
    await timeout(500)

    if (!res.nextPage) break;    
    res = await res.nextPage.fetch()
  }
}



try {
  test()
} catch (error) {
  console.log("Error", error)
}
