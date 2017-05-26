# Quickly start several requests for what template apps are available
curl "https://localhost:8000/getTemplateList" &
curl "https://localhost:8000/getTemplateList" &

# ...then start several app duplication requests, keeping the load scripts of the template app
curl "https://localhost:8000/duplicateKeepScript?templateAppId=abcd1234-abcd-45fc-b609-1310761c4f48&appName=aabb_keep_1&ownerUserId=<username>" &
curl "https://localhost:8000/duplicateKeepScript?templateAppId=abcd1234-abcd-45fc-b609-1310761c4f48&appName=aabb_keep_2&ownerUserId=<username>" &
curl "https://localhost:8000/duplicateKeepScript?templateAppId=abcd1234-abcd-45fc-b609-1310761c4f48&appName=aabb_keep_3&ownerUserId=<username>" &
curl "https://localhost:8000/duplicateKeepScript?templateAppId=abcd1234-abcd-45fc-b609-1310761c4f48&appName=aabb_keep_4&ownerUserId=<username>" &
curl "https://localhost:8000/duplicateKeepScript?templateAppId=abcd1234-abcd-45fc-b609-1310761c4f48&appName=aabb_keep_5&ownerUserId=<username>" &

# ...then start duplication requests where the load script is replaced
curl "https://localhost:8000/duplicateNewScript?templateAppId=abcd1234-abcd-45fc-b609-1310761c4f48&appName=aabb_new_1&ownerUserId=<username>" &
curl "https://localhost:8000/duplicateNewScript?templateAppId=abcd1234-abcd-45fc-b609-1310761c4f48&appName=aabb_new_2&ownerUserId=<username>" &
curl "https://localhost:8000/duplicateNewScript?templateAppId=abcd1234-abcd-45fc-b609-1310761c4f48&appName=aabb_new_3&ownerUserId=<username>" &
curl "https://localhost:8000/duplicateNewScript?templateAppId=abcd1234-abcd-45fc-b609-1310761c4f48&appName=aabb_new_4&ownerUserId=<username>" &
curl "https://localhost:8000/duplicateNewScript?templateAppId=abcd1234-abcd-45fc-b609-1310761c4f48&appName=aabb_new_5&ownerUserId=<username>" &

# ...wrap up by doing a few more requests for available template apps
curl "https://localhost:8000/getTemplateList" &
curl "https://localhost:8000/getTemplateList" &
curl "https://localhost:8000/getTemplateList" &


