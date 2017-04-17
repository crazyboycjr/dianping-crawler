# Dianping-crawler

点评数据格式
```json
{
  "shop_id": 21316992,
  "shop_name": "很高兴遇见你",
  "address": "邯郸路600号万达商业广场特力时尚汇5层",
  "lat": "31.302196",
  "lng": "121.512774",
  "city_id": 1,
  "city_name": "上海",
  "main_category_name": "创意菜",
  "main_category_id": 250,
  "category_name": "美食",
  "main_region_id": 854,
  "shop_power": 40,
  "shop_group_id": 16966242,
  "district": 0,
  "avg_price": 106,
  "default_review_count": 13719,
  "total_review_count": 13719,
  "rating": {
    "口味": "8.1",
    "环境": "8.9",
    "服务": "8.6"
  },
  "all_reviews": {
    "default_numbers": 13719,
    "all_stars": {
      "star_1": 216,
      "star_2": 413,
      "star_3": 1793,
      "star_4": 4960,
      "star_5": 6337
    }
  },
  "default_reviews": {
    "review_number": 10883,
    "review_info": [
      {
        "user_id": "888233149",
        "rating": [
          3,
          4,
          3
        ],
        "content": "丰衣足食不错，三生三世有点小失望。",
        "date": "04-16",
        "photo_number": 0
      }
    ]
  },
  "checkin_reviews": {
    "review_number": 311,
    "review_info": [
      {
        "user_id": "615325",
        "check_in": "15-12-26 18:18",
        "content": "",
        "star": 3,
        "photo_number": 1
      }
    ]
  }
}
```

数据来源:
```
GET http://www.dianping.com/shop/17179979 最下面<script>标签内有window.config = {}
GET http://www.dianping.com/ajax/json/shopDynamic/reviewAndStar?shopId=17179979&cityId=1&mainCategoryId=205
GET http://www.dianping.com/shop/17179979/review_all 默认点评
GET http://www.dianping.com/shop/17179979/review_short 签到短评
```

很可惜，暂时还不能拿到纯checkin的信息，如果有方法，欢迎发issue或者私聊

由于点评严格的反爬虫机制，我们放弃了原先的分布式架构，转而使用[阿布云](https://www.abuyun.com)
