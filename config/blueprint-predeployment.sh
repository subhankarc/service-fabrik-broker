#!/bin/bash
export OPENSTACK_ENDPOINT="https://cluster-4.eu-de-1.cloud.sap:5000/v3/"
export OPENSTACK_USERNAME="I041148"
export OPENSTACK_PASSWORD="Srini123"
export OPENSTACK_DOMAIN="HCP_CF_01"
export OPENSTACK_TENANT_NAME="sf-docker"
export OPENSTACK_TENANT_ID="945806d1a6c94eecb44a1e8946377b5d"

SERVER_GROUP_NAME=$1

#echo $(date) "[DEBUG][IPFAILOVER] - Fetching token"


ENDPOINT="$OPENSTACK_ENDPOINT"
#echo $(date) "[DEBUG][IPFAILOVER] - Openstack Keystone endpoint is $ENDPOINT"
DOMAINNAME="$OPENSTACK_DOMAIN"
#echo $(date) "[DEBUG][IPFAILOVER] - Openstack domain name is $DOMAINNAME"
PROJECTNAME="$OPENSTACK_TENANT_NAME"
#echo $(date) "[DEBUG][IPFAILOVER] - Openstack project/tenant name is $PROJECTNAME"
USER="$OPENSTACK_USERNAME"
#echo $(date) "[DEBUG][IPFAILOVER] - Openstack user is $USER"
PASSWORD="$OPENSTACK_PASSWORD"

NETWORK_NAME="$NETWORK_NAME" #"services_z1" #services_z1
#echo $(date) "[DEBUG][IPFAILOVER] - Openstack network name is $NETWORK_NAME"

if [ -z "$ENDPOINT" ] || [ -z "$DOMAINNAME" ] || [ -z "$PROJECTNAME" ] || [ -z "$USER" ] || [ -z "$PASSWORD" ]; then
  #echo $(date) "[ERROR][IPFAILOVER] - All the values like endpoint domain name, project name, user, password must be filled."
  exit 1
fi

#jq="/var/vcap/packages/jq_package/bin/jq"
jq="jq"


TOKEN_ENDPOINT="$ENDPOINT/auth/tokens"
#echo $(date) "[DEBUG][IPFAILOVER] - Openstack keystone authentication endpoint is $TOKEN_ENDPOINT"
#echo $(date) "[DEBUG][IPFAILOVER] - We first authenticate with keystone API to get the Auth Token and the API catalogs of Openstack"
#First lets get the auth token and list of API endpoints
RESPONSE=$(curl -ks -X POST $TOKEN_ENDPOINT -H "Content-Type: application/json" -w "\n%{http_code}" -d "{ \"auth\" : {\"identity\" : {\"password\" : {\"user\" : {\"name\" : \"$USER\", \"domain\" : {\"name\" : \"$DOMAINNAME\"}, \"password\" : \"$PASSWORD\"}}, \"methods\" : [ \"password\" ]},\"scope\" : {\"project\" : {\"name\" : \"$PROJECTNAME\", \"domain\" : {\"name\" : \"$DOMAINNAME\"}}}}}")
RET=$?
if [[ $RET -ne 0 ]] ; then
    :
    # if error exit code, print exit code
    #echo $(date) "[ERROR][IPFAILOVER] - Error $RET"
    # print HTTP error
    #echo $(date) "[ERROR][IPFAILOVER] - HTTP Error: $(echo "$RESPONSE" | tail -n1 )"
else
    # otherwise print last line of output, i.e. HTTP status code
    #echo $(date) "[DEBUG][IPFAILOVER] - Success in getting the keystone authentication response, HTTP status is:"
    #echo $(date) "$RESPONSE" | tail -n1
    # and print all but the last line, i.e. the regular response
    RESPONSE=$(echo "$RESPONSE" | head -1)
fi

# Getting the Auth Token
export TOKEN=$(curl -ksi -X POST $TOKEN_ENDPOINT -H "Content-Type: application/json" -w "\n%{http_code}" -d "{ \"auth\" : {\"identity\" : {\"password\" : {\"user\" : {\"name\" : \"$USER\", \"domain\" : {\"name\" : \"$DOMAINNAME\"}, \"password\" : \"$PASSWORD\"}}, \"methods\" : [ \"password\" ]},\"scope\" : {\"project\" : {\"name\" : \"$PROJECTNAME\", \"domain\" : {\"name\" : \"$DOMAINNAME\"}}}}}" | awk '/X-Subject-Token/ {print $2}' )
#echo $(date) "[DEBUG][IPFAILOVER] - keystone authentication done. Auth Token is $TOKEN"
if  [ -z "$TOKEN" ];then
  #echo $(date) "[DEBUG][IPFAILOVER] - Token not generated. exiting"
  exit 1
fi
#Getting the catalog of different APIs from the response
CATALOGS=$(echo $RESPONSE  | $jq .token.catalog[] )
#echo "and Catalog is also fetched"

COMPUTE_CATALOG_ENDPOINTS=$(echo $CATALOGS | $jq '. | select(.type=="compute") | .endpoints ')
COMPUTE_PUBLIC_URL=$(echo $CATALOGS | $jq -r '. | select(.type=="compute") | .endpoints[] | select(.interface=="public") | .url')

#echo $(date) "[DEBUG][IPFAILOVER]" "COMPUTE CATALOG ENDPOINT " $COMPUTE_CATALOG_ENDPOINTS
#echo $(date) "[DEBUG][IPFAILOVER]" "COMPUTE PUBLIC URL " $COMPUTE_PUBLIC_URL

SERVER_GROUP_ENDPOINT="$COMPUTE_PUBLIC_URL/os-server-groups"
CREATE_SERVER_GROUP_RESPONSE=$(curl -ks -H "X-Auth-Token:$TOKEN" -H "Content-type: application/json" -X POST $SERVER_GROUP_ENDPOINT -d "{ \"server_group\": { \"name\": \"$SERVER_GROUP_NAME\", \"policies\": [\"anti-affinity\"] } }")

LIST_SERVER_GROUP_RESPONSE=$(curl -ks -H "X-Auth-Token:$TOKEN" -H "Content-type: application/json" $SERVER_GROUP_ENDPOINT )

#echo $(date) "[DEBUG][SERVER-GROUP] - List of server-groups are $LIST_SERVER_GROUP_RESPONSE"

SERVER_GROUPS=$(echo $LIST_SERVER_GROUP_RESPONSE | $jq '.server_groups[]')
#echo $SERVER_GROUPS

SG_ID=$(echo $LIST_SERVER_GROUP_RESPONSE | $jq -r --arg SERVER_GROUP_NAME "$SERVER_GROUP_NAME" '.server_groups[] | select(.name==$SERVER_GROUP_NAME) | .id')
echo $SG_ID