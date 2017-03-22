require 'octokit'
require 'json'

# TODO
# - DONE remove hard coded access token
# - check in and push
# - README.md, LICENSE
# - rewrite in Node so can run on all Lambda/Function clouds
#   - ES7, transpile to ES5
#   - build tools
#   - client or server in TypeScript
# - switch to raw HTTP and save full json response & etag
# - info on size of each group to allow filtering in client

CLIENT = Octokit::Client.new(:access_token => ENV["GITHUB_TOKEN"])


class Ref
    attr_reader :id
    def initialize(id)
        @id = id
    end
    def to_s
        "ref<#{@id}>"
    end
end

def refs_from_text(body_text)
    # FIXME this regex will skip low-numbered issues
    return if body_text == nil
    body_text.scan(/#(\d{3,7})/) do
        yield Ref.new($1.to_i)
    end
end

def refs_from_comments(comments)
    comments.each do |comment|
        refs_from_text(comment.body) do |ref_id|
            yield ref_id
        end
    end
end

def refs_from_issue(issue)
    refs_from_text(issue.title) do |refd_issue_id|
        yield refd_issue_id
    end
    refs_from_text(issue.body) do |refd_issue_id|
        yield refd_issue_id
    end
    # FIXME paginated comments, like JL/j 19545
    refs_from_comments(issue.rels[:comments].get.data) do |refd_issue_id|
        yield refd_issue_id
    end
end


def nodes_and_links_for_issue(issue_id, issue)
    node = {:id => issue_id, 
            :state => issue.state,
            :title => issue.title,
            :body => issue.body,
            :html => issue.rels[:html] }
    node[:pull_request_html_url] = issue.pull_request.rels[:html] if issue.pull_request != nil

    seen_targets = {}
    links = []
    refs_from_issue(issue) do |ref|
        next if seen_targets[ref.id]
        seen_targets[ref.id] = true
        links.push({:source => issue_id, 
                    :target => ref.id})
    end
    [[node], links]
end

def nodes_and_links_for_open_issues()
    all_nodes = []
    all_links = []

    issues = CLIENT.issues('JuliaLang/julia', :per_page => 100)
    1.upto(3) do
        next_issues = CLIENT.last_response.rels[:next]
        issues.each do |issue|
            STDERR.puts(issue.number)
            sleep(1)
            ns, ls = *nodes_and_links_for_issue(issue.number, issue)
            all_nodes.push(*ns)
            all_links.push(*ls)
        end
        issues = next_issues.get.data
    end

    # Make if a link points to a node we haven't seen, make a fake node
    # for the links to point to.
    # FIXME adds some nodes multiple times - needs uniq before each?
    (all_links.map{|l| l[:target]} - all_nodes.map{|n| n[:id]}).each do |id|
        all_nodes.push({:id => id, :state => "unknown"})
    end

    puts({:nodes => all_nodes, :links => all_links}.to_json)
end



nodes_and_links_for_open_issues()
