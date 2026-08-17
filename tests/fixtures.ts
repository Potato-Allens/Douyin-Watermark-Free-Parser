export const VIDEO_HTML = String.raw`
<html>
  <script>
    window.__DATA__ = {
      "aweme_id":"7673000000000000001",
      "desc":"示例视频标题",
      "create_time":1700000000,
      "author":{"nickname":"作者A","signature":"签名A"},
      "statistics":{"aweme_id":"7673000000000000001","comment_count":12,"digg_count":345,"share_count":6,"collect_count":7},
      "video":{
        "play_addr":{"uri":"v0200fg10000abc123douyin"},
        "cover":{"url_list":["https://p3-sign.douyinpic.com/tos-cn-i-0813/cover.jpeg"]}
      },
      "music":{
        "title":"示例背景音乐",
        "author":"音乐作者",
        "cover_medium":{"url_list":["https://p3-sign.douyinpic.com/tos-cn-i-0813/music.jpeg"]},
        "play_url":{"url_list":["https://p3-sign.douyinpic.com/music/example.mp3"]}
      }
    };
  </script>
</html>`;

export const IMAGE_HTML = String.raw`
<html>
  <script>
    window.__DATA__ = {
      "aweme_id":"7673000000000000002",
      "desc":"示例图文标题",
      "create_time":1710000000,
      "author":{"nickname":"作者B","signature":"签名B"},
      "statistics":{"aweme_id":"7673000000000000002","comment_count":1,"digg_count":2,"share_count":3,"collect_count":4},
      "music":{"title":"图文音乐","author":"图文作者"},
      "images":[
        {"uri":"image-1","url_list":["https:\/\/p3-sign.douyinpic.com\/tos-cn-i-0813\/a.jpeg?x=1\\u0026y=2"]},
        {"uri":"image-1","url_list":["https://p3-sign.douyinpic.com/tos-cn-i-0813/a.jpeg?x=1&y=2"]},
        {"uri":"image-obj","url_list":["https://p3-sign.douyinpic.com/obj/ignored.jpeg"]},
        {"uri":"image-2","url_list":["https://p11-sign.douyinpic.com/tos-cn-i-0813/b.jpeg"]}
      ]
    };
  </script>
</html>`;

export const EMPTY_HTML = `<html><body>empty</body></html>`;

export function makeFixtureFetcher(html: string, resolvedUrl = "https://www.douyin.com/video/7673000000000000001") {
  return async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } });
}

export function makeFailedFetcher(status = 503) {
  return async () => new Response("upstream failed", { status });
}
