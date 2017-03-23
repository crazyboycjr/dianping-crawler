# Dianping-crawler

点评数据格式
```json
{
	"shop_id": "17179979",
	"shop_name": "名城煲王 • 明星粤菜馆",
	"address": "延安中路802号",
	"lat": "31.224281",
	"lng": "121.459262", 
	"city_id": "1",
	"city_name": "上海",
	"main_category_name": "粤菜馆",
	"category_name": "美食",
	
	"rating": 4.5,
	"avg_price": 197,
	"default_review_count": 2993,
	"total_review_count": 3006
	"rating": {
		"口味": 8.7,
		"环境": 7.8,
		"服务": 7.8
	},
	"default_reviews": {
		"review_number": 2737,
		"review_info": [
			{
				"user_id": "22845919",
				"date": "03-05",
				"content": "首先点评一下服务",
				"photo_number": 0,
				"rating": [3, 3, 4]
			}
		]
	},
	"checkin_reviews": {
		"review_number": 8,
		"review_info": [
			{
				"user_id": "22845919",
				"check_in": "15-04-24 16:16",
				"content": "一般般吧",
				"photo_number": 1,
				"star": 3
			}
		]
	},

	"all_reviews": {
		"default_numbers": 3006,
		"all_star": {
			"star_1": 72,
			"star_2": 87,
			"star_3": 342,
			"star_4": 1114,
			"star_5": 1380
		}
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

分布式爬虫架构

```
待完善
```
